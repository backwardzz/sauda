-- Первый вход по приглашению. Приглашённый не регистрируется отдельно: в окне входа он вводит почту,
-- на которую владелец отправил приглашение, и форма сама предлагает придумать пароль.
-- Для этого форме нужно знать до входа, что на почту есть приглашение, а аккаунта ещё нет.
-- Функция отвечает только «да/нет» и не раскрывает, кто пригласил.
create function public.invite_pending(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(trim(p_email), '') <> ''
    and exists (select 1 from invites i where lower(i.email) = lower(trim(p_email)))
    and not exists (select 1 from auth.users u where lower(u.email) = lower(trim(p_email)))
$$;

revoke all on function public.invite_pending(text) from public;
grant execute on function public.invite_pending(text) to anon, authenticated;
