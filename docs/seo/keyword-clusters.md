# 關鍵字群集（考試指南）

資料：Ubersuggest，地區台灣（locId 2158），語言 zh，查詢日 2026-11-06。月搜尋量為工具估計值，只用來排優先順序。

架構：hub-and-spoke。Hub `/guide/` 接住主要詞，各 spoke 接一組意圖相同的長尾詞，彼此以「延伸閱讀」互連，所有文章連回練習功能（/practice/、/exam/、/full/、/plan/）。

| 頁面 | 主要關鍵字（月量） | 次要關鍵字 | 搜尋意圖 |
|---|---|---|---|
| `/guide/` 考試指南 | ipas ai應用規劃師（12,100）、ai應用規劃師（8,100） | ipas證照（1,300）、ai ipas（110）、ipas是什麼（210） | 認識考試 |
| `/guide/beginner/` | ai應用規劃師初級（480） | ipas 初級 中級 | 初級考什麼 |
| `/guide/intermediate/` | ai應用規劃師中級（480） | ai應用規劃師 中級 dcard | 中級考什麼、選科 |
| `/guide/registration/` | ipas考試（480）、ipas報名（320） | ipas費用、ai應用規劃師 2026／115 | 日期與報名 |
| `/guide/study-plan/` | ipas ai應用規劃師 dcard（880）、ai應用規劃師 ptt／dcard（320） | ai應用規劃師課程（390） | 準備方法、心得 |
| `/guide/practice-questions/` | ipas ai應用規劃師 考古題（390） | ipas 考古題（170）、ipas 題庫（110）、模擬考 | 找題目練習 |
| `/guide/faq/` | ipas是什麼（210） | 證書效期、抵免、可否先考中級 | 單點疑問 |

未納入：iPAS 其他證照（淨零碳、資安工程師等），與本站題庫無關。

考試事實的出處與查核日見 `src/lib/guides.ts` 的 `SRC` 與 `FACTS_CHECKED`；每年新簡章公告後要重新核對 `/guide/registration/` 與 `/guide/faq/`。
