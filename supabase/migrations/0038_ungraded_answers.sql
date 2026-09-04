alter type public.grader_kind add value if not exists 'ungraded';

comment on column public.attempt_answers.grader is
  'Кто выставил оценку: deterministic — сравнение с эталоном, ai — модель, '
  'pending — ещё ждёт модель, ungraded — оценить не удалось (модель была недоступна).';
