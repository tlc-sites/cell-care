-- 확인: true 가 나오면 긴 글 제한이 모두 풀린 것입니다
select not exists (
    select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
     where c.contype='c' and (n.nspname, t.relname) in (('public','pastoral_notes'),('public','msg_posts'),('public','announcements'),
           ('report','cellcare_comment_replies'),('report','cellcare_report_talk'),('report','cellcare_member_moves'))
       and pg_get_constraintdef(c.oid) ~ '<= (1000|2000|3000|4000)\)')
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.prokind='f'
       and p.proname in ('lr_save','msg_post','msg_start','note_comment_add','notice_create','pastor_msg_save','review_update','save_report','senior_comment_add')
       and pg_get_functiondef(p.oid) ~ '(, (2000|3000|4000)\)|> 4000)')
  and (select count(*) from pg_constraint where conname in ('msg_posts_body_check','pastoral_notes_content_check','cellcare_comment_replies_content_check','cellcare_report_talk_content_check')) = 4
  as ok;
