// Invented records only. Never replace fixtures with production care data.
module.exports = {
  week: '2026-10-12', generated_at: '2026-10-16T08:00:00Z', auth_user_id: '00000000-0000-0000-0000-000000000001',
  status: [{ cell_name: '사랑셀', status: 'submitted' }, { cell_name: '소망셀', status: null }],
  messages: [{ author: '김예시', cell_name: '사랑셀', content: '셀 가족들이 서로 격려하며 기도하고 있습니다.\n한 주도 함께 기도해 주세요.', content_en: 'Our cell members are encouraging and praying for one another.\nPlease pray with us this week.' }],
  pastoral_status: [{ author_name: '이예시', status: 'submitted' }, { author_name: '박예시', status: 'none' }],
  pastoral_reports: [{ author_name: '이예시', summary: '이번 주 두 가정에 연락했습니다.', items: [{ person_name: '정예시', group_name: '사랑셀', category: 'update', content: '새로운 일상에 잘 적응하고 있습니다.' }] }],
  notes: [{ person_name: '최예시', met_on: '2026-10-14', category: 'prayer', visit_method: 'phone', content: '전화로 안부를 나누었습니다.', prayer: '새로운 한 주를 위해 기도해 주세요.', needs_pastor: true, i_acked: false }],
  reports: [{ cell_name: '사랑셀', group_name: '이예시', meeting_date: '2026-10-13', present: 7, absent: 1, grace_notes: '말씀을 읽고 받은 은혜를 나누었습니다.', leader_message: 'contact', leader_message_note: '이번 주 연락을 부탁드립니다.',
    care: [{ person_name: '정예시', category: 'update', content: '서로 안부를 묻고 격려했습니다.', prayer: '감사한 마음으로 지내도록 기도해 주세요.', leadership_attention_required: true }],
    prayers: [{ member_name: '최예시', content: '새로운 일정을 위해 기도해 주세요.', this_week_note: '평안하게 준비하고 있습니다.' }],
    new_prayers: [{ person_name: '김예시', content: '가족 모임을 위해 기도해 주세요.' }],
    reviews: [{ review_note: '금요일에 다시 연락하여 안부를 확인하겠습니다.', escalation_level: 'attention' }] }]
};
