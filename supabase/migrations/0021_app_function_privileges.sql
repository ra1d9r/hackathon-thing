
revoke all on all functions in schema app from public, anon, authenticated;

alter default privileges in schema app
  revoke execute on functions from public, anon, authenticated;

grant execute on function
  app.my_role(),
  app.is_teacher(),
  app.is_class_member(uuid),
  app.owns_class(uuid),
  app.shares_class_with(uuid),
  app.is_channel_member(uuid)
to authenticated;

grant execute on all functions in schema app to service_role;
