package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"gorm.io/gorm"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("必须设置 DATABASE_URL")
	}
	dataDir := os.Getenv("CANVAS_BACKEND_DATA_DIR")
	if dataDir == "" {
		dataDir = "/data"
	}

	db, err := database.Open(database.Config{Driver: "postgres", DSN: dsn, DataDir: dataDir})
	if err != nil {
		log.Fatalf("连接数据库失败: %v", err)
	}
	repo := repository.New(db)
	svc := service.New(repo, dataDir)

	fmt.Println("=== 开始执行生图价格与渠道配置 ===")

	// 1. 爱拍AI (CHANNEL_000001): 进价 0.06 元 (60,000 micros)
	updateChannelImagePricing(db, repo, "CHANNEL_000001", "爱拍AI中转站", 60_000, []string{
		"gpt-image-2",
		"gpt-image-2.5-flare-firefly",
		"gpt-image-2.5-sunburst-firefly",
	})

	// 2. LensAPI (CHANNEL_000003): 进价 0.01 元 (10,000 micros)
	updateChannelImagePricing(db, repo, "CHANNEL_000003", "LensAPI 中转站", 10_000, []string{
		"gpt-image-2",
		"gpt-image-2.5",
		"gpt-image-2.5-flare",
		"gpt-image-2.5-sunburst",
		"ecommerce-image-studio",
	})

	// 3. OpenAI 官方渠道 (CHANNEL_000002): 最终扣除 0.5 积分 -> 进价/基准单价 0.25 元 (250,000 micros)
	updateChannelImagePricing(db, repo, "CHANNEL_000002", "OpenAI 官方渠道", 250_000, []string{
		"gpt-image-2",
		"gpt-image-2.5-flare",
		"gpt-image-2.5-sunburst",
		"chatgpt-image-latest",
	})

	// 4. MoAI 图片专线: 单独渠道
	setupMoAIImageChannel(db, repo, svc)

	fmt.Println("=== 生图价格与渠道配置执行完毕 ===")
}

func updateChannelImagePricing(db *gorm.DB, repo *repository.Repository, channelID string, channelName string, unitMicros int64, modelKeys []string) {
	fmt.Printf("\n--- 更新渠道 [%s (%s)] 生图定价 (基准/进价: %d micros = %.4f 元, 2倍抵扣: %.4f 积分) ---\n", channelName, channelID, unitMicros, float64(unitMicros)/1_000_000, float64(unitMicros*2)/1_000_000)

	var models []model.ChannelModel
	if err := db.Where("channel_id = ? AND model_key IN ? AND deleted_at IS NULL", channelID, modelKeys).Find(&models).Error; err != nil {
		log.Fatalf("查询渠道模型失败: %v", err)
	}

	for _, m := range models {
		res := db.Model(&model.ChannelModelPriceTier{}).
			Where("channel_model_id = ? AND deleted_at IS NULL", m.ID).
			Updates(map[string]any{
				"unit_price_microcredits":      unitMicros,
				"cost_configured":              true,
				"cost_unit_price_microcredits": unitMicros,
				"price_configured":             true,
				"price_version":                gorm.Expr("price_version + 1"),
				"updated_at":                   time.Now(),
			})
		if res.Error != nil {
			log.Fatalf("更新模型价格档失败 [%s]: %v", m.ModelKey, res.Error)
		}
		fmt.Printf("已更新模型 [%s (ID: %s)] 的价格档共 %d 行 -> 单价 %d micros\n", m.ModelKey, m.ID, res.RowsAffected, unitMicros)

		// 更新或插入 model_pricings 表
		var pricing model.ModelPricing
		err := db.Where("channel_id = ? AND model = ? AND capability = 'image'", channelID, m.ModelKey).First(&pricing).Error
		if err == nil {
			db.Model(&pricing).Updates(map[string]any{
				"per_request_micros": unitMicros,
				"currency":           "CNY",
				"updated_at":         time.Now(),
			})
			fmt.Printf("已更新进价表 model_pricings [%s]: %d micros\n", m.ModelKey, unitMicros)
		} else if errorsIsNotFound(err) {
			pricingID := nextPricingID(db)
			newPricing := model.ModelPricing{
				ID:               pricingID,
				ChannelID:        channelID,
				Model:            m.ModelKey,
				Capability:       "image",
				Currency:         "CNY",
				PerRequestMicros: unitMicros,
				CreatedAt:        time.Now(),
				UpdatedAt:        time.Now(),
			}
			if err := db.Create(&newPricing).Error; err != nil {
				log.Fatalf("插入进价表失败: %v", err)
			}
			fmt.Printf("已新建进价表记录 [%s (ID: %s)]: %d micros\n", m.ModelKey, pricingID, unitMicros)
		}
	}
}

func setupMoAIImageChannel(db *gorm.DB, repo *repository.Repository, svc *service.Service) {
	fmt.Println("\n--- 配置 MoAI 图片单独渠道 ---")
	channelName := "MoAI 生图专线 (image.moai.wiki)"
	baseURL := "https://image.moai.wiki"
	apiKeyPlain := os.Getenv("MOAI_IMAGE_API_KEY")
	if apiKeyPlain == "" {
		log.Fatal("必须设置 MOAI_IMAGE_API_KEY")
	}
	moaiImageModels := []string{"gpt-image-2", "gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"}
	modelsJSONBytes, _ := json.Marshal(moaiImageModels)

	var existingChannel model.ModelChannel
	err := db.Where("base_url = ? AND name LIKE ? AND deleted_at IS NULL", baseURL, "%MoAI%图%").First(&existingChannel).Error
	var targetChannelID string

	if err == nil {
		targetChannelID = existingChannel.ID
		fmt.Printf("检测到已存在 MoAI 图片渠道 [ID: %s], 更新其密钥与配置...\n", targetChannelID)
		encryptedKey, encErr := svc.EncryptSettingSecret(apiKeyPlain)
		if encErr != nil {
			log.Fatalf("加密 APIKey 失败: %v", encErr)
		}
		db.Model(&existingChannel).Updates(map[string]any{
			"name":        channelName,
			"api_key":     encryptedKey,
			"enabled":     true,
			"models_json": string(modelsJSONBytes),
			"updated_at":  time.Now(),
		})
	} else if errorsIsNotFound(err) {
		newChannelID, idErr := repo.NextPrefixedID("CHANNEL")
		if idErr != nil {
			log.Fatalf("生成 Channel ID 失败: %v", idErr)
		}
		targetChannelID = newChannelID
		encryptedKey, encErr := svc.EncryptSettingSecret(apiKeyPlain)
		if encErr != nil {
			log.Fatalf("加密 APIKey 失败: %v", encErr)
		}

		var maxOrder int
		db.Model(&model.ModelChannel{}).Select("COALESCE(MAX(sort_order), 0)").Scan(&maxOrder)

		newChan := model.ModelChannel{
			ID:                targetChannelID,
			Scope:             model.ChannelScopeSystem,
			Enabled:           true,
			Name:              channelName,
			PublicAlias:       "",
			SortOrder:         maxOrder + 1,
			BaseURL:           baseURL,
			APIKey:            encryptedKey,
			SecretKey:         "",
			APIFormat:         "openai",
			ConcurrencyLimit:  0,
			ModelsJSON:        string(modelsJSONBytes),
			RetiredModelsJSON: "[]",
			HeadersJSON:       "[]",
			CreatedAt:         time.Now(),
			UpdatedAt:         time.Now(),
		}
		if err := db.Create(&newChan).Error; err != nil {
			log.Fatalf("创建 MoAI 图片渠道记录失败: %v", err)
		}
		fmt.Printf("成功创建 MoAI 图片专线渠道 [ID: %s]\n", targetChannelID)
	} else {
		log.Fatalf("查询 MoAI 渠道异常: %v", err)
	}

	var templateModel model.ChannelModel
	if err := db.Where("channel_id = 'CHANNEL_000003' AND model_key = 'gpt-image-2' AND deleted_at IS NULL").First(&templateModel).Error; err != nil {
		log.Fatalf("获取生图能力模板失败: %v", err)
	}

	unitMicros := int64(10_000) // 0.01 元一次，2倍后 0.02 积分
	for idx, modelKey := range moaiImageModels {
		var cm model.ChannelModel
		mErr := db.Where("channel_id = ? AND model_key = ? AND deleted_at IS NULL", targetChannelID, modelKey).First(&cm).Error
		var modelID string
		if mErr == nil {
			modelID = cm.ID
			db.Model(&cm).Updates(map[string]any{
				"enabled":    true,
				"sort_order": idx + 1,
				"updated_at": time.Now(),
			})
			fmt.Printf("模型 [%s (ID: %s)] 已存在，更新状态\n", modelKey, modelID)
		} else if errorsIsNotFound(mErr) {
			newModelID, idErr := repo.NextPrefixedID("MODEL")
			if idErr != nil {
				log.Fatalf("生成 Model ID 失败: %v", idErr)
			}
			modelID = newModelID
			cm = model.ChannelModel{
				ID:                   modelID,
				ChannelID:            targetChannelID,
				ModelKey:             modelKey,
				Capability:           "image",
				Protocol:             "openai-image",
				CapabilityConfigJSON: templateModel.CapabilityConfigJSON,
				PriceCurrency:        "credits",
				Enabled:              true,
				SortOrder:            idx + 1,
				PriceVersion:         1,
				CreatedAt:            time.Now(),
				UpdatedAt:            time.Now(),
			}
			if err := db.Create(&cm).Error; err != nil {
				log.Fatalf("创建渠道模型失败 [%s]: %v", modelKey, err)
			}
			fmt.Printf("成功创建渠道模型 [%s (ID: %s)]\n", modelKey, modelID)
		}

		var tier model.ChannelModelPriceTier
		tErr := db.Where("channel_model_id = ? AND deleted_at IS NULL", modelID).First(&tier).Error
		if tErr == nil {
			db.Model(&tier).Updates(map[string]any{
				"unit_price_microcredits":      unitMicros,
				"cost_configured":              true,
				"cost_unit_price_microcredits": unitMicros,
				"price_configured":             true,
				"price_version":                gorm.Expr("price_version + 1"),
				"updated_at":                   time.Now(),
			})
			fmt.Printf("已更新模型 [%s] 价格档 -> %d micros (ID: %s)\n", modelKey, unitMicros, tier.ID)
		} else if errorsIsNotFound(tErr) {
			tierID, idErr := repo.NextPrefixedID("PTIER")
			if idErr != nil {
				log.Fatalf("生成 Ptier ID 失败: %v", idErr)
			}
			newTier := model.ChannelModelPriceTier{
				ID:             tierID,
				ChannelModelID: modelID,
				SelectorKey:    "{}",
				SelectorJSON:   "{}",
				BillingMode:    "fixed_request",
				CostPricing: model.CreditCostPricing{
					Configured:            true,
					UnitPriceMicrocredits: unitMicros,
				},
				UnitPriceMicrocredits: unitMicros,
				PriceConfigured:       true,
				Enabled:               true,
				PriceVersion:          1,
				CreatedAt:             time.Now(),
				UpdatedAt:             time.Now(),
			}
			if err := db.Create(&newTier).Error; err != nil {
				log.Fatalf("创建模型价格档失败 [%s]: %v", modelKey, err)
			}
			fmt.Printf("已创建模型 [%s] 价格档 -> %d micros (ID: %s)\n", modelKey, unitMicros, tierID)
		}

		var pricing model.ModelPricing
		pErr := db.Where("channel_id = ? AND model = ? AND capability = 'image'", targetChannelID, modelKey).First(&pricing).Error
		if pErr == nil {
			db.Model(&pricing).Updates(map[string]any{
				"per_request_micros": unitMicros,
				"currency":           "CNY",
				"updated_at":         time.Now(),
			})
		} else if errorsIsNotFound(pErr) {
			pricingID := nextPricingID(db)
			newPricing := model.ModelPricing{
				ID:               pricingID,
				ChannelID:        targetChannelID,
				Model:            modelKey,
				Capability:       "image",
				Currency:         "CNY",
				PerRequestMicros: unitMicros,
				CreatedAt:        time.Now(),
				UpdatedAt:        time.Now(),
			}
			if err := db.Create(&newPricing).Error; err != nil {
				log.Fatalf("插入进价表失败: %v", err)
			}
			fmt.Printf("已创建进价表记录 [%s (ID: %s)]: %d micros\n", modelKey, pricingID, unitMicros)
		}
	}
}

func errorsIsNotFound(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "record not found") || strings.Contains(err.Error(), "sql: no rows"))
}

func nextPricingID(db *gorm.DB) string {
	var maxID string
	db.Model(&model.ModelPricing{}).Select("MAX(id)").Scan(&maxID)
	num := 0
	if maxID != "" && strings.HasPrefix(maxID, "PRICING_") {
		fmt.Sscanf(strings.TrimPrefix(maxID, "PRICING_"), "%d", &num)
	}
	return fmt.Sprintf("PRICING_%03d", num+1)
}
