'use strict';
// รายชื่อผู้ใช้ที่อนุญาต (สูงสุด 20 คน) — แก้ไข id/password ตรงนี้ได้เลย
//
// ⚠️ คำเตือน: นี่เป็นเว็บ static ไม่มี server ตรวจสอบรหัสผ่าน การเช็คเกิดขึ้นในเบราว์เซอร์ล้วนๆ
// ใครก็ตามที่เปิด "View Page Source" หรือ DevTools จะเห็นรายการรหัสผ่านนี้ได้ทั้งหมด
// ใช้เพื่อกันคนทั่วไปที่ไม่มี id/password เข้ามากดเล่นเฉยๆ เท่านั้น ห้ามใช้รหัสผ่านที่ใช้จริงที่อื่นซ้ำ
const USERS = [
  { id: 'user1', password: 'change-me-1' },
  { id: 'user2', password: 'change-me-2' },
  { id: 'user3', password: 'change-me-3' },
  // เพิ่มได้สูงสุดรวม 20 แถว เช่น:
  // { id: 'somchai', password: 'xxxxx' },
];
