update public.learning_goals
   set is_active = false
 where goal = 'olympiad';

update public.exam_profiles
   set is_active = false
 where goal = 'olympiad';

update public.student_profiles
   set goal = 'subjects'::public.learning_goal,
       target_exam_id = null,
       target_date = null
 where goal = 'olympiad';

comment on column public.learning_goals.is_active is
  'Выключенная цель не предлагается в онбординге и не проходит валидацию контракта.';
