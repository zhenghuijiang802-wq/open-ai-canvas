/** 漫画画风选项。预览图仅用于选择，自定义上传图由画风档案单独绑定。 */
export type ComicStylePreset = { id: string; title: string; prompt: string; coverUrl: string };

export const COMIC_STYLE_PRESETS: readonly ComicStylePreset[] = [
    {
        "id": "manga-shonen",
        "title": "少年漫画",
        "prompt": "shonen manga, explosive action, bold ink lines, speed lines and expressive heroic staging; insanely dynamic illustration of the current comic scene. best quality, high resolution. crazy artstyle, careless brushstrokes, emotional and fun, shonen manga action energy, impact frames, speed lines, exaggerated expression, high tension comic panel rhythm, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/manga-shonen-1.webp"
    },
    {
        "id": "manga-shojo",
        "title": "少女漫画",
        "prompt": "shojo manga, delicate linework, luminous eyes, floral details and romantic emotional framing; kawaii style the current comic scene. cute, adorable, brightly colored, cheerful, anime influence, highly detailed, shojo manga, delicate lines, sparkles, floral motifs, soft romantic close-ups, pastel emotional tone, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/manga-shojo-1.webp"
    },
    {
        "id": "manga-chibi",
        "title": "Q版",
        "prompt": "chibi manga, super-deformed proportions, compact silhouettes and playful readable expressions; Adorable Kawaii, the current comic scene, pretty, cute, adorable, kawaii, chibi comic, oversized heads, tiny bodies, rounded linework, cute reaction faces, playful gag timing, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/manga-chibi-1.webp"
    },
    {
        "id": "manga-horror",
        "title": "恐怖漫画",
        "prompt": "Japanese horror manga, unsettling black ink, oppressive shadows and psychological tension; horror-themed the current comic scene. eerie, unsettling, dark, spooky, suspenseful, grim, highly detailed, horror manga, oppressive black ink, unsettling faces, tense negative space, psychological dread, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/manga-horror-1.webp"
    },
    {
        "id": "korean-webtoon",
        "title": "韩漫",
        "prompt": "polished Korean webtoon, cinematic vertical storytelling, elegant characters and luminous color rendering; anime artwork the current comic scene. anime style, key visual, vibrant, studio anime, highly detailed, Korean webtoon style, polished cel shading, vertical scroll pacing, attractive character rendering, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/korean-webtoon-1.webp"
    },
    {
        "id": "manhua-wuxia",
        "title": "武侠",
        "prompt": "Chinese wuxia manhua, flowing martial arts movement, period costumes and dramatic qi effects; highly detailed black sumi-e painting of the current comic scene. in-depth study of perfection, created by a master. best quality, high resolution, wuxia manhua, sword trails, flowing robes, misty jianghu atmosphere, martial arts choreography, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/manhua-wuxia-1.webp"
    },
    {
        "id": "manhua-modern",
        "title": "现代国漫",
        "prompt": "modern Chinese manhua, crisp digital linework, cinematic urban lighting and polished character design; anime artwork illustrating the current comic scene. created by japanese anime studio. highly emotional. best quality, high resolution, modern Chinese manhua, clean digital line art, crisp lighting, expressive character design, cinematic panels, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/manhua-modern-1.webp"
    },
    {
        "id": "manhua-ink",
        "title": "水墨",
        "prompt": "Chinese ink-wash manhua, expressive brushwork, atmospheric negative space and restrained mineral colors; big long brushstrokes of deep black sumi-e turning into symbolic painting of the current comic scene. master level raw art. best quality, high resolution, Chinese guofeng ink wash, hanfu silhouettes, rice paper texture, calligraphic brush movement, poetic negative space, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/manhua-ink-1.webp"
    },
    {
        "id": "superhero-comic",
        "title": "超级英雄漫画",
        "prompt": "modern superhero comic, powerful anatomy, dynamic foreshortening, bold inks and dramatic color separation; brave, shocking, and brutally true art showing the current comic scene. inspired by courage and unlimited creativity. truth found in chaos. best quality, high resolution, superhero comic book, heroic anatomy, dramatic foreshortening, capes, city-scale action, powerful silhouettes, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/superhero-comic-1.webp"
    },
    {
        "id": "comic-indie",
        "title": "独立漫画",
        "prompt": "independent comic, authorial linework, expressive color choices and graphic-novel composition; centered black and white high contrast line drawing, coloring book style,the current comic scene. monochrome, blank white background, indie graphic novel, expressive imperfect linework, restrained palette, grounded personal storytelling, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/comic-indie-1.webp"
    },
    {
        "id": "sketch-pop-art",
        "title": "波普漫画",
        "prompt": "pop-art comic, halftone dots, flat saturated colors, bold contours and vintage print energy; pop Art style the current comic scene. bright colors, bold outlines, popular culture themes, ironic or kitsch, pop comic page, bold outlines, Ben-Day dots, graphic speech effects, playful commercial print energy, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/sketch-pop-art-1.webp"
    },
    {
        "id": "euro-clear-line-adventure",
        "title": "清线冒险欧漫",
        "prompt": "European ligne claire adventure comic, uniform clean outlines, flat colors and precise readable environments; Simple Vector Art, the current comic scene, 2D flat, simple shapes, minimalistic, professional graphic, flat color, high contrast, Simple Vector Art, ligne claire Franco-Belgian comic, even clean lines, minimal hatching, bright flat colors, readable backgrounds, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/euro-clear-line-adventure-1.webp"
    },
    {
        "id": "bd-graphic-novel",
        "title": "图像小说",
        "prompt": "European graphic novel, sophisticated draftsmanship, restrained palette and literary cinematic framing; line art drawing the current comic scene. professional, sleek, modern, minimalist, graphic, line art, vector graphics, European bande dessinee, clean contour lines, detailed environments, expressive faces, balanced flat colors, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/bd-graphic-novel-1.webp"
    },
    {
        "id": "sketch-pencil",
        "title": "铅笔素描",
        "prompt": "graphite pencil sketch comic, visible construction lines, layered hatching, paper grain and monochrome tonal modeling; sublime ancient illustration of the current comic scene, predating human civilization. crude and simple, but also surprisingly beautiful artwork, made by genius primeval artist. best quality, high resolution, gekiga realism, rough ink texture, mature faces, austere framing, dense hatching, dramatic realism, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/sketch-pencil-1.webp"
    },
    {
        "id": "sketch-watercolor",
        "title": "水彩",
        "prompt": "watercolor comic illustration, transparent pigment blooms, soft paper texture and hand-painted edges; watercolor painting the current comic scene. vibrant, beautiful, painterly, detailed, textural, artistic, comic page, visible watercolor paper texture, soft color bleeding, gentle hand-painted storytelling, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/sketch-watercolor-1.webp"
    },
    {
        "id": "sketch-woodcut",
        "title": "木刻版画",
        "prompt": "woodcut print comic, carved angular marks, stark black-and-white contrast and handmade relief texture; Gyotaku the current comic scene. Fish impressions, realistic details, ink rubbings, textured surfaces, traditional Japanese art form, nature-inspired compositions, artistic representation of marine life, black and white contrasts, cultural significance., woodcut and ink rubbing comic texture, carved black lines, high contrast printmaking, folk storytelling, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/sketch-woodcut-1.webp"
    },
    {
        "id": "classic-2d-fairytale",
        "title": "经典2D童话",
        "prompt": "classic hand-drawn 2D fairytale animation, storybook shapes, painted backgrounds and warm theatrical lighting; fairy tale the current comic scene. magical, fantastical, enchanting, storybook style, highly detailed, children's picture book comic, soft friendly illustration, warm safe atmosphere, gentle characters, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/classic-2d-fairytale-1.webp"
    },
    {
        "id": "modern-3d-princess-fantasy",
        "title": "现代3D公主奇幻",
        "prompt": "modern 3D princess fantasy animation, refined stylized faces, ornate costumes, magical particles and cinematic lighting; heroic fantasy painting of the current comic scene, in the dangerous fantasy world. airbrush over oil on canvas. best quality, high resolution, painterly fantasy comic, rich brush texture, cinematic light, readable silhouettes, epic panel composition, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/modern-3d-princess-fantasy-1.webp"
    },
    {
        "id": "warm-stylized-3d",
        "title": "温暖风格化3D",
        "prompt": "warm stylized 3D animation, appealing rounded forms, tactile materials and expressive family-film acting; Whimsical and Playful, the current comic scene, imaginative, fantastical, bight colors, stylized, happy, Whimsical and Playful, cartoon comedy comic, exaggerated expressions, elastic body language, bright colors, clear gag timing, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/warm-stylized-3d-1.webp"
    },
    {
        "id": "pastoral-hand-painted-anime",
        "title": "田园手绘动画",
        "prompt": "pastoral hand-painted anime, watercolor backgrounds, gentle cel characters, natural light and quiet lived-in detail; Cel Shaded Art, the current comic scene, 2D, flat color, toon shading, cel shaded style, anime cel shading, clean shadow shapes, animation staging, polished readable comic panels, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/pastoral-hand-painted-anime-1.webp"
    },
    {
        "id": "realistic-3d",
        "title": "3D CG渲染",
        "prompt": "high-end 3D CG render, physically based materials, volumetric cinematic lighting and detailed production design; comic the current comic scene. graphic illustration, comic art, graphic novel art, vibrant, highly detailed, contemporary American comic, bold inks, vibrant colors, dynamic poses, cinematic action panels, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/realistic-3d-1.webp"
    },
    {
        "id": "realistic-photo",
        "title": "写实",
        "prompt": "photorealistic cinematic comic imagery, believable skin and materials, natural lens behavior and controlled film lighting; breathtaking illustration from adult comic book presenting the current comic scene. fabulous artwork. best quality, high resolution, mature seinen manga, grounded anatomy, restrained acting, cinematic shadows, serious graphic novel mood, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/realistic-photo-1.webp"
    },
    {
        "id": "realistic-cyberpunk",
        "title": "赛博朋克",
        "prompt": "photorealistic cyberpunk cinema, wet neon streets, dense futuristic production design and high-contrast colored light; cyberpunk cityscape the current comic scene. neon lights, dark alleys, skyscrapers, futuristic, vibrant colors, high contrast, highly detailed, comic page, neon rain, holographic interfaces, chrome circuitry, dense futuristic urban panels, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/realistic-cyberpunk-1.webp"
    },
    {
        "id": "realistic-steampunk",
        "title": "蒸汽朋克",
        "prompt": "photorealistic steampunk cinema, brass machinery, Victorian tailoring, smoke, workshop detail and amber film lighting; steampunk style the current comic scene. antique, mechanical, brass and copper tones, gears, intricate, detailed, steampunk comic, brass pipes, gears, Victorian costumes, mechanical airships, sepia industrial fantasy, comic page ready, clear panel storytelling, stable recurring characters, readable silhouettes, avoid photorealistic stock photo, broken anatomy, unreadable panels, UI, watermark",
        "coverUrl": "/comic-style-previews/realistic-steampunk-1.webp"
    }
];

