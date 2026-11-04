-- 已知梯次。新梯次請另開 migration 新增（勿修改已套用的 migration）。
-- 中級 2026-11-14 依 GLOSSARY「梯次」；初級梯次日期尚未確認，待擁有者依簡章新增。
INSERT INTO exam_sittings (id, level, exam_date, name, sale_open, created_at)
VALUES ('intermediate-2026-11-14', 'intermediate', '2026-11-14', '2026 年 11 月中級', TRUE, '2026-11-04T00:00:00.000Z');
