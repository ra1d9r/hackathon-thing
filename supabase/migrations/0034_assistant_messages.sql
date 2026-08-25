-- 0034 — фаза 10: сообщения ассистента.
--
-- Таблицы чата заведены ещё в 0009, и менять их форму не требуется: канал
-- ассистента (`kind = 'ai_assistant'`) и сообщения в нём уже описаны, RLS
-- и публикация Realtime — тоже. Здесь добавлено только то, чего не хватило,
-- когда ответ ассистента стал не просто текстом.

-- ─── Служебные поля ответа ───────────────────────────────────────────────────

-- Ответ ассистента несёт не только текст: список затронутых тем и до трёх
-- предложенных действий («открыть урок», «начать задачу»). Класть их в
-- `attachments` нельзя — там будут файлы учителя (фаза 11), и разбирать
-- один массив по двум несовместимым формам пришлось бы на каждой стороне.
alter table public.chat_messages
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.chat_messages
  drop constraint if exists chat_messages_meta_object;

alter table public.chat_messages
  add constraint chat_messages_meta_object
  check (jsonb_typeof(meta) = 'object');

comment on column public.chat_messages.meta is
  'Служебное содержимое ответа: referenced_topics, suggested_actions, refusal_reason, source.';

-- ─── Связь с работой очереди ─────────────────────────────────────────────────

-- `ai_job_id` существует с 0009, но внешнего ключа у него не было: на тот
-- момент очередь ещё не была создана. Теперь она есть, и висящий
-- идентификатор удалённой работы означал бы ссылку в никуда.
--
-- `on delete set null`, а не `cascade`: работа — служебная запись, а
-- сообщение ученик уже прочитал. Удалять переписку вслед за журналом нельзя.
alter table public.chat_messages
  drop constraint if exists chat_messages_ai_job_fk;

alter table public.chat_messages
  add constraint chat_messages_ai_job_fk
  foreign key (ai_job_id) references public.ai_jobs(id) on delete set null;

-- Ответ ассистента ищется по работе, которая его породила: обработчик
-- проверяет, не записан ли он уже, а долгий опрос — готов ли он.
create index if not exists chat_messages_ai_job_idx
  on public.chat_messages(ai_job_id)
  where ai_job_id is not null;

-- ─── Листание истории ────────────────────────────────────────────────────────

-- История отдаётся страницами от свежих к старым, курсор — `(created_at, id)`.
-- Пары одинаковых `created_at` внутри одного канала реальны: вопрос ученика
-- и мгновенный отказ модерации пишутся одной транзакцией. Без `id` в индексе
-- порядок между ними не определён, и страница могла бы повторить сообщение
-- или потерять его.
create index if not exists chat_messages_channel_seq_idx
  on public.chat_messages(channel_id, created_at desc, id desc);

-- Прежний индекс — строгий префикс нового, и планировщику больше не нужен.
drop index if exists public.chat_messages_channel_idx;
