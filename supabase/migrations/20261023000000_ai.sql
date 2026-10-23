-- AI lead scoring fields
alter table public.leads
  add column if not exists ai_score     text check (ai_score in ('hot', 'warm', 'cold')),
  add column if not exists ai_summary   text,
  add column if not exists ai_next_step text,
  add column if not exists ai_scored_at timestamptz;

-- Saving an AI score should not count as the lead being "updated"
-- (the Booked-this-month stat reads updated_at).
create or replace function public.leads_before_update() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - array['ai_score','ai_summary','ai_next_step','ai_scored_at','updated_at'])
     is distinct from
     (to_jsonb(old) - array['ai_score','ai_summary','ai_next_step','ai_scored_at','updated_at']) then
    new.updated_at := now();
  end if;
  return new;
end $$;
