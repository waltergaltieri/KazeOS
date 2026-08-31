alter table public.settings
  add column locale text not null default 'es-AR';

alter table public.settings
  add constraint settings_locale_not_blank
  check (btrim(locale) <> '');
