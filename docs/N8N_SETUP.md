# ตั้งค่า n8n + Google Sheets

## 1. สร้างตารางของทีม

สร้าง Google Spreadsheet ในบัญชีที่ต้องการใช้กับ n8n หรือให้บัญชีนั้นมีสิทธิ์ editor บนไฟล์ แยกแท็บชื่อให้ตรงตัวพิมพ์:

| แท็บ | CSV ที่นำเข้า |
|---|---|
| products | data/raw/products.csv |
| inventory | data/raw/inventory_snapshot.csv |
| policies | data/generated/replenishment_rules.csv |
| requests | data/generated/requests_empty.csv |

ให้แถวที่ 1 เป็นชื่อคอลัมน์ ไม่เพิ่มหัวเรื่องด้านบน สำรองไฟล์ดิบเดิมไว้เสมอ ตรวจคอลัมน์ as_of หลังนำเข้า ต้องครบ 82 แถวและเป็นค่าเดิม ตั้งเขตเวลาของ spreadsheet เป็น Asia/Bangkok

## 2. นำเข้า workflow

1. สร้าง workflow ว่างใน n8n
2. เลือก Import → From file และเลือก `workflows/01_stock_planner_google_sheets.json`
3. ถ้าแก้ workflow เดิม **อย่านำเข้าเพิ่มบน canvas ที่มี node อยู่** เพราะ n8n จะต่อท้ายและเปลี่ยนชื่อ node ให้อัตโนมัติ ให้สำรอง export ก่อน แล้วล้าง node ในฉบับร่างหรือเริ่ม workflow ใหม่ จึงนำเข้า
4. ที่ Google Sheets node ทั้ง 7 จุด เลือกบัญชี Google ที่มีสิทธิ์กับตาราง
5. ตั้ง Document ID ให้เป็น spreadsheet ของทีม ตรวจชื่อแท็บ products, inventory, policies, requests
6. ขั้นอ่านทุกตารางตั้ง **Execute Once** แล้ว เพื่อไม่ให้อ่านตารางถัดไปซ้ำตามจำนวนแถวที่ไหลเข้า ห้ามปิดค่านี้โดยไม่ทดสอบ

ไฟล์ export สำหรับแจกไม่มี credential ของผู้สร้างและใช้ placeholder Spreadsheet ID ต้องเลือกบัญชีและไฟล์ของตนเอง

## 3. ป้องกัน webhook

ที่ Planner Webhook เลือก Header Auth สร้าง credential ที่ใช้ชื่อ header `X-Planner-Key` และค่าสุ่มยาวที่เก็บเป็นความลับ อย่าใช้รหัสผ่าน Google เป็นค่า header นี้

นำค่าเดียวกันไปใส่ N8N_AUTH_TOKEN ใน `.env.local` บนเครื่องผู้ใช้ ไฟล์นี้ถูก .gitignore และไม่ควรส่งอาจารย์หรือใส่ ZIP ที่เผยแพร่

เมื่อไม่ส่ง header หรือส่งค่าผิด n8n ควรปฏิเสธก่อนอ่านตาราง สิทธิ์ webhook นี้ใช้เฉพาะระบบต้นแบบ ไม่ใช่ระบบยืนยันผู้อนุมัติหลายบทบาท

## 4. เปิดใช้งานและเชื่อมหน้าจอ

Publish workflow แล้วคัดลอก **Production URL** จาก Planner Webhook ตั้งค่า:

```dotenv
PORT=8787
API_PORT=8788
N8N_WEBHOOK_URL=https://YOUR_INSTANCE.app.n8n.cloud/webhook/baandee-stock-planner
N8N_AUTH_TOKEN=YOUR_PROJECT_HEADER_AUTH_VALUE
```

ใช้ `START_N8N.bat` หรือ `node --env-file=.env.local src/server.mjs` หน้าเว็บเปิดที่ 127.0.0.1:8787 และส่งคำขอผ่านตัวกลางบนเครื่อง จึงไม่ฝังรหัส n8n ไว้ใน JavaScript ที่ browser ดาวน์โหลด

n8n Cloud ไม่สามารถเรียก API ที่ 127.0.0.1 ของเครื่องผู้ใช้ จึงใช้ workflow Google Sheets สำหรับ Cloud ส่วน `02_local_bridge.json` มีไว้สำหรับ n8n ที่รันบนเครื่องเดียวกับ data API เท่านั้น ไม่ต้องเปิด tunnel เพื่อใช้เส้นทาง Cloud นี้

## 5. ทดสอบก่อนสาธิต

```sh
node --env-file=.env.local scripts/integration_test.mjs
```

ตรวจไฟล์ cloud-integration.json/CSV มี input, expected, actual, PASS/FAIL ถ้าอ่าน Sheets ไม่ได้ ให้ตรวจบัญชีและสิทธิ์ ไม่เปิดไฟล์เป็น public เพื่อแก้ปัญหา

workflow `03_rule_verification.json` ใช้ Manual Trigger ทดสอบกฎ 7 กรณีโดยไม่ต้องมี Google credential เป็นการทดสอบกฎเท่านั้น ไม่ใช่หลักฐานว่าเส้นทาง Sheets บันทึกได้

## เส้นทางข้อมูลใน workflow

1. Planner Webhook รับ action และข้อมูลจากหน้าจอ
2. Read products/inventory/policies/requests อ่านแต่ละแหล่งครั้งเดียว
3. Validate and Plan ตรวจข้อมูล แยกกำกวม คำนวณ และตรวจรายการซ้ำ/revision
4. Needs Write แยกคำขออ่าน/ข้อผิดพลาดออกจากคำขอเขียน
5. Is New แยก append กับ update โดยใช้ request_id จับคู่
6. Read Saved Proposal อ่านข้อมูลกลับ
7. Verify Readback ตรวจ quantity, revision และ status ตรงกับที่บันทึก
8. Respond ส่ง HTTP status และผลให้หน้าจอ

## ข้อผิดพลาดและการยืนยันผล

- 404: ไม่พบสินค้า/ใบเสนอ
- 409: มีรายการซ้ำ ข้อมูลถูกแก้ไปแล้ว หรือเปลี่ยนสถานะไม่ถูกต้อง
- 422: ข้อมูลที่ผู้ใช้ส่งหรือหลักฐานประกอบไม่ผ่านกฎ
- 503: แหล่งข้อมูล/การบันทึก/การอ่านยืนยันไม่พร้อม ให้ค้นหารายการก่อนลองใหม่
- ถ้าบันทึกสำเร็จแต่คำตอบหลุด ระบบอาจยังมีแถวนั้นอยู่ ใช้ idempotency key เดิมสำหรับคำขอเดิม และตรวจใบเสนอ ไม่สร้างใหม่ด้วย key ใหม่ทันที
- Google Sheets ไม่มี transaction แบบฐานข้อมูล ต้นแบบนี้จำกัดการสาธิตทีละผู้ใช้ ถ้าจะรองรับพร้อมกันต้องเปลี่ยนส่วนเก็บข้อมูลให้มี transaction และ unique constraint

## ก่อนส่ง GitHub

ใช้ export ที่สร้างจาก `scripts/build_workflows.mjs` ซึ่งไม่มี credential references หรือเอาออกจาก export ของ n8n ด้วยตนเอง ลบ pinned/execution data และ URL ส่วนตัวก่อนส่ง ไม่แนบ `.env.local`, var/runtime.env หรือฐานข้อมูล n8n

workflow บน n8n Cloud ที่ทดสอบตั้ง `Save failed production executions`, `Save successful production executions` และ `Save manual executions` เป็น **Do not save** และปิด `Save execution progress` แล้ว เพื่อลดการเก็บข้อมูลขาเข้าของ webhook ใน execution history; export JSON ที่สร้างใหม่ก็ใส่ค่าไม่บันทึกไว้ด้วย
