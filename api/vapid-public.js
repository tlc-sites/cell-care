// 알림 받기에 필요한 공개 키 (공개해도 되는 값)
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.VAPID_PUBLIC_KEY || '';
  res.status(key ? 200 : 503).json({ key });
};
