/** 考試指南 articles (hub-and-spoke keyword clusters, docs/seo/keyword-clusters.md); order = reading order on the hub. */
export interface Guide { path: string; title: string; description: string; image: string; alt: string }

/** Date the official facts in the guides were last checked against the iPAS site. */
export const FACTS_CHECKED = '2026-11-06';

export const GUIDES: Guide[] = [
  { path: '/guide/beginner/', title: 'AI 應用規劃師初級：科目、題型、及格標準', image: 'beginner', alt: '學習者與 AI 助理對話、踏上階梯的插圖',
    description: 'iPAS AI 應用規劃師初級考什麼？L11 人工智慧基礎概論、L12 生成式 AI 應用與規劃的評鑑主題、作答時間、及格標準與證書效期，依 115 年度簡章整理。' },
  { path: '/guide/intermediate/', title: 'AI 應用規劃師中級：必考選考、證書類別與程式題', image: 'intermediate', alt: '在白板上規劃資料管線與機器學習模型的插圖',
    description: 'iPAS AI 應用規劃師中級怎麼考？L21 必考加 L22 或 L23 擇一，對應數據分析或機器學習證書；含程式題比例、作答時間、及格標準與舊證照抵免。' },
  { path: '/guide/registration/', title: 'iPAS AI 應用規劃師報名與考試日期（115 年度）', image: 'registration', alt: '行事曆、線上報名表與准考證的插圖',
    description: '115 年度 iPAS AI 應用規劃師初級四梯、中級兩梯的報名期間、考試日期、成績公告日、報名費優惠與報名網址整理，附官方出處。' },
  { path: '/guide/study-plan/', title: 'AI 應用規劃師怎麼準備？讀書計畫與準備方法', image: 'study-plan', alt: '書桌上的檢核清單與通往獎盃的路徑插圖',
    description: '從學習指引到模擬考：iPAS AI 應用規劃師初級、中級的準備步驟、4 週與 8 週讀書計畫範例，以及考前一週該做的事。' },
  { path: '/guide/practice-questions/', title: 'iPAS AI 應用規劃師考古題、題庫與模擬考怎麼用', image: 'practice', alt: '答案卡、計時器與成績圖表的插圖',
    description: '官方公告試題去哪裡找？考古題、模擬題與題庫各有什麼用途，怎麼用單科模考、錯題本與弱點分析提高 iPAS AI 應用規劃師的分數。' },
  { path: '/guide/faq/', title: 'iPAS AI 應用規劃師常見問題', image: 'hub', alt: '考生在筆電前查看 AI 圖表與證書的插圖',
    description: 'iPAS 是什麼？AI 應用規劃師要先考初級才能考中級嗎？證書效期多久、單科成績保留幾年、可以帶自己的電腦嗎？一次整理常見問題。' },
];

export const guideOf = (path: string) => GUIDES.find((g) => g.path === path)!;

/** Official iPAS sources the guides cite (checked FACTS_CHECKED). */
export const SRC = {
  brochure: ['iPAS《115 年度 AI 應用規劃師能力鑑定簡章（初、中級）》', 'https://www.ipas.org.tw/api/proxy/uploads/certification/AIAP/115%E5%B9%B4%E5%BA%A6AI%E6%87%89%E7%94%A8%E8%A6%8F%E5%8A%83%E5%B8%AB%E8%83%BD%E5%8A%9B%E9%91%91%E5%AE%9A%E7%B0%A1%E7%AB%A0(%E5%88%9D%E3%80%81%E4%B8%AD%E7%B4%9A)_0105_20260105184002.pdf'],
  examInfo: ['iPAS AI 應用規劃師：考試資訊', 'https://ipd.nat.gov.tw/ipas/certification/AIAP/exam-info'],
  downloads: ['iPAS AI 應用規劃師：下載專區（簡章、學習指引、公告試題）', 'https://ipd.nat.gov.tw/ipas/certification/AIAP/downloads'],
  news: ['iPAS AI 應用規劃師：最新消息', 'https://ipd.nat.gov.tw/ipas/certification/AIAP/news'],
  scope: ['iPAS《AI 應用規劃師能力鑑定評鑑內容範圍參考》（115.02 版）', 'https://www.ipas.org.tw/api/proxy/uploads/certification_news/05a129ac3ddb4b3da23fef4abecfa0e3/AI%E6%87%89%E7%94%A8%E8%A6%8F%E5%8A%83%E5%B8%AB%E8%83%BD%E5%8A%9B%E9%91%91%E5%AE%9A_%E8%A9%95%E9%91%91%E5%85%A7%E5%AE%B9%E7%AF%84%E5%9C%8D%E5%8F%83%E8%80%83_11502_20260226174411.pdf'],
  coding: ['iPAS 公告：中級 L22、L23 程式題說明（2026-03-31）', 'https://ipd.nat.gov.tw/ipas/certification/AIAP/news/ffdba0fcdbda40baadeef2a1bdc0230e'],
  errata: ['iPAS 公告：中級學習指引勘誤（2026-04-10）', 'https://ipd.nat.gov.tw/ipas/certification/AIAP/news/6152aa72abd9468ebcd9275a358f43b1'],
  register: ['iPAS 線上報名系統', 'https://reg.ipas.org.tw/'],
} satisfies Record<string, [string, string]>;
