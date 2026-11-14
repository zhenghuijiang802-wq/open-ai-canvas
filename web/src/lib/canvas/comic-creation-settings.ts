// Creation choices follow Comic Keker's creation settings; drawing style is selected separately.
export const COMIC_STORY_TYPES = [
    ["auto", "自动判断"], ["original", "原文驱动"], ["campus", "校园恋爱"], ["workplace", "职场恋爱"],
    ["reunion", "久别重逢"], ["secret", "暗恋故事"], ["misunderstanding", "误会化解"], ["destiny", "命中注定"],
    ["forbidden", "禁忌之恋"], ["regret", "追妻火葬场"], ["mystery", "悬疑推理"], ["fantasy", "玄幻修真"],
    ["urban", "都市"], ["history", "历史古风"], ["scifi", "科幻"], ["horror", "恐怖惊悚"], ["wuxia", "武侠"], ["adventure", "奇幻冒险"],
].map(([value, label]) => ({ value, label }));

export const COMIC_EMOTION_TONES = [
    ["auto", "自动判断"], ["original", "原文驱动"], ["sweet", "甜宠"], ["angst", "虐心"], ["funny", "搞笑"],
    ["forbidden", "禁忌"], ["suspense", "悬疑紧张"], ["epic", "史诗宏大"], ["horror", "恐怖压抑"], ["warm", "温暖治愈"],
].map(([value, label]) => ({ value, label }));

export const COMIC_NARRATIVE_PRESETS = [
    { value: "audio_comic_drama", label: "定格漫剧", direction: "按信息揭示顺序组织单镜画面，强化人物视线、反应与表情。只生成无字底图提示词。" },
    { value: "single_dialogue_v3_webtoon", label: "单镜条漫", direction: "每个分镜定格一个瞬间，按手机连续阅读的节奏衔接相邻画面，保持动作、视线与持物连续。" },
    { value: "cinematic_single_panel", label: "电影叙事", direction: "以建立空间、人物反应、关键动作结果组织相邻镜头；远中近景依剧情变化，避免连续同构图。转场使用原文已有地点、时间与物件，不增加事件。" },
    { value: "relationship_single_panel", label: "人物关系", direction: "以人物距离、身体朝向、视线回避与道具接触呈现原文关系变化。只呈现已有关系，不默认恋爱或亲密接触。" },
    { value: "suspense_single_panel", label: "线索悬疑", direction: "保持线索出现、人物察觉、反应与结论的原文顺序；先交代可见证据的位置，再呈现反应。严格区分读者与角色已知信息，不提前揭底。" },
    { value: "action_single_panel", label: "动作叙事", direction: "按原文分解准备、接触、结果的因果，每镜只冻结一个阶段；写清左右手占用、重心、受力对象和方向。保持轴线、距离、伤势与持物连续，不增加招式或武器。" },
    { value: "pov_suspense_single_panel", label: "第一人称悬疑", direction: "使用原文视角人物的主观观察组织画面，严格限制其可见范围和知情边界；通过可见线索与反应呈现悬念，不凭空补充事实。" },
];

export function comicCreationChoice(value: unknown, options: readonly { value: string; label: string }[], fallback: string): string {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !options.some(option => option.value === value)) throw new Error("漫画创作设置无效，请重新选择");
    return value;
}

export function comicCreationDirection(settings: { storyType?: string; emotionTone?: string; narrativePreset?: string }): string {
    const story = COMIC_STORY_TYPES.find(option => option.value === settings.storyType) || COMIC_STORY_TYPES[0];
    const tone = COMIC_EMOTION_TONES.find(option => option.value === settings.emotionTone) || COMIC_EMOTION_TONES[0];
    const preset = COMIC_NARRATIVE_PRESETS.find(option => option.value === settings.narrativePreset) || COMIC_NARRATIVE_PRESETS[0];
    return `故事类型：${story.label}。情绪与色调：${tone.label}。这两项只影响表达重点，自动判断或原文驱动时依据原文；不得为迎合题材或情绪增删事实、人物关系或结局。\n叙事预设：${preset.label}。${preset.direction}\n所有预设只组织单镜叙事，不添加排版、气泡、音频或图中文字。`;
}
