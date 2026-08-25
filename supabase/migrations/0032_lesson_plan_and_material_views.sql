-- 0032 — фаза 7: два представления материала и редактируемый план урока.
--
-- Два требования заказчика от 2026-08-20 (04-domain-logic.md, §6.6 и §6.7),
-- которые до фазы 7 негде было применить:
--
--   1. Материал существует в двух видах. Ученик читает скан страницы
--      учебника или фотографию — он лежит в файлах приложения и доступен
--      офлайн всегда. Модель читает `ai_text` и ничего кроме. Их нельзя
--      объединить: скан для модели бесполезен, а подпись «страница 42»
--      она начнёт достраивать сама.
--
--   2. Тема урока неизменна, а состав заданий пишет модель — и её план
--      это черновик, а не результат. Правка человека должна пережить
--      перегенерацию, поэтому черновик и действующий план хранятся
--      раздельно.

-- ─── Представление материала для ученика ─────────────────────────────────────

create type public.material_view_kind as enum ('markdown', 'bundled', 'file', 'link');

alter table public.materials
  add column if not exists student_view_kind public.material_view_kind,
  add column if not exists bundle_key        text,
  add column if not exists bundle_hash       text;

-- Существующие материалы — библиотека и тексты учителей — это разметка.
update public.materials
   set student_view_kind = case
         when format in ('markdown', 'txt') then 'markdown'::public.material_view_kind
         when format = 'link'               then 'link'::public.material_view_kind
         else 'file'::public.material_view_kind
       end
 where student_view_kind is null;

alter table public.materials
  alter column student_view_kind set not null,
  alter column student_view_kind set default 'markdown';

-- Актив в сборке приложения описывается ключом и контрольной суммой —
-- и только ими. Байты сервер не хранит и не отдаёт: файл приезжает
-- вместе с релизом приложения, поэтому доступен и без сети.
alter table public.materials
  add constraint materials_bundle_payload check (
    (student_view_kind = 'bundled' and bundle_key is not null and bundle_hash is not null)
    or (student_view_kind <> 'bundled' and bundle_key is null and bundle_hash is null)
  );

-- Путь внутри сборки: никаких схем, абсолютных путей и выхода вверх.
-- Проверка здесь, а не только в коде: ключ попадает в ответ клиенту,
-- и он же становится путём в файловой системе устройства.
alter table public.materials
  add constraint materials_bundle_key_shape check (
    bundle_key is null
    or (bundle_key ~ '^[a-z0-9][a-z0-9._/-]{0,190}$' and bundle_key !~ '\.\.')
  );

comment on column public.materials.student_view_kind is
  'Как материал показывается ученику. `bundled` — актив из сборки приложения, офлайн всегда.';
comment on column public.materials.bundle_key is
  'Путь актива внутри сборки, например textbook/math/trigonometry/p42.png. Байты сервер не хранит.';
comment on column public.materials.bundle_hash is
  'sha256 актива в сборке. Клиент сверяет его со своим файлом и знает, что материал обновился.';

-- ─── План урока: черновик модели и действующая версия ────────────────────────

alter table public.roadmap_nodes
  add column if not exists outline_draft jsonb not null default '[]'::jsonb,
  add column if not exists outline_edited_at timestamptz,
  add column if not exists rationale text;

-- Узлы, созданные до этой миграции, ещё не правились: черновик равен плану.
update public.roadmap_nodes
   set outline_draft = outline
 where outline_draft = '[]'::jsonb
   and outline <> '[]'::jsonb;

comment on column public.roadmap_nodes.outline_draft is
  'План, предложенный моделью. Перегенерация переписывает его, а outline — только если правок не было.';
comment on column public.roadmap_nodes.outline is
  'Действующий план урока: черновик модели либо правка человека поверх него.';
comment on column public.roadmap_nodes.outline_edited_at is
  'Когда план правил человек. Не null — перегенерация правку не затирает.';

-- ─── Прогресс урока: связь с узлом плана ─────────────────────────────────────
--
-- Узел и прогресс урока обязаны сходиться (04-domain-logic.md, §4.3), но
-- искать узел по уроку приходилось перебором всех активных карт ученика.

create index if not exists roadmap_nodes_lesson_idx
  on public.roadmap_nodes(lesson_id) where lesson_id is not null;

create index if not exists lesson_progress_student_idx
  on public.lesson_progress(student_id, updated_at desc);

-- Права не трогаем: 0016 выдаёт `select` на таблицу целиком, поэтому новые
-- колонки покрыты им автоматически. Поколоночных грантов в схеме нет.
