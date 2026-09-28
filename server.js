const express = require('express');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

let sock;
let rawQrCode = '';
let isConnected = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        keepAliveIntervalMs: 15000, // إرسال نبضات كل 15 ثانية لمنع انقطاع الجلسة
        connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('⚡ تم توليد QR Code جديد');
            rawQrCode = qr;
            isConnected = false;
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = (statusCode !== DisconnectReason.loggedOut);
            
            console.log(`⚠️ انقطع الاتصال (كود ${statusCode}). جاري إعادة الاتصال تلقائياً:`, shouldReconnect);
            
            isConnected = false;
            rawQrCode = '';

            if (shouldReconnect) {
                // إعادة الاتصال تلقائياً بعد 3 ثوانٍ
                setTimeout(() => {
                    connectToWhatsApp();
                }, 3000);
            } else {
                console.log('❌ تم تسجيل الخروج من الهاتف، يرجى إعادة مسح الـ QR Code.');
            }
        } else if (connection === 'open') {
            console.log('✅ تم الاتصال بواتساب بنجاح وهو جاهز للعمل!');
            isConnected = true;
            rawQrCode = '';
        }
    });
}

// بدء الاتصال عند تشغيل السيرفر
connectToWhatsApp();

// 1. مسار الصحة (Health Check) لإبقاء السيرفر مستيقظاً بواسطة UptimeRobot
app.get('/ping', (req, res) => {
    res.status(200).send('PONG - Server is Alive');
});

// 2. الصفحة الرئيسية: عرض الـ QR Code أو حالة الاتصال
app.get('/', (req, res) => {
    if (isConnected) {
        res.send(`
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>حالة خدمة الواتساب</title>
                <style>
                    body { font-family: system-ui, sans-serif; text-align: center; padding-top: 50px; background-color: #f4f7f6; }
                    .card { background: white; padding: 30px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
                    h1 { color: #2e7d32; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>✅ الواتساب متصل بنجاح!</h1>
                    <p>السيرفر يعمل الآن وجاهز لاستقبال واستبدال طلبات الرسائل.</p>
                </div>
            </body>
            </html>
        `);
    } else if (rawQrCode) {
        const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(rawQrCode)}`;
        res.send(`
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>ربط الواتساب</title>
                <style>
                    body { font-family: system-ui, sans-serif; text-align: center; padding-top: 40px; background-color: #f4f7f6; }
                    .card { background: white; padding: 30px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
                    img { border: 2px solid #ddd; border-radius: 8px; padding: 10px; margin-top: 15px; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>📱 امسح رمز الـ QR للربط بالواتساب</h2>
                    <img src="${qrApiUrl}" alt="QR Code" />
                    <p style="color: #555; margin-top: 15px;">افتح واتساب في هاتفك > الأجهزة المرتبطة > ربط جهاز.</p>
                </div>
                <script>
                    setTimeout(() => { location.reload(); }, 5000);
                </script>
            </body>
            </html>
        `);
    } else {
        res.send(`
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>جاري التحميل...</title>
                <style>
                    body { font-family: system-ui, sans-serif; text-align: center; padding-top: 50px; background-color: #f4f7f6; }
                </style>
            </head>
            <body>
                <h2>⏳ جاري تجهيز اتصال السيرفر بـ واتساب...</h2>
                <p>يرجى الانتظار بضع ثوانٍ وسيقوم المتصفح بالتحديث تلقائياً.</p>
                <script>
                    setTimeout(() => { location.reload(); }, 3000);
                </script>
            </body>
            </html>
        `);
    }
});

// 3. API لإرسال الرسائل من Apps Script
app.post('/send-otp', async (req, res) => {
    try {
        const { phone, otp, message } = req.body;

        if (!isConnected) {
            return res.status(503).json({ success: false, error: 'الواتساب غير متصل حالياً بالسيرفر' });
        }

        if (!phone) {
            return res.status(400).json({ success: false, error: 'رقم الهاتف (phone) مطلوب' });
        }

        let formattedPhone = phone.toString().replace(/[^0-9]/g, '');
        if (!formattedPhone.endsWith('@s.whatsapp.net')) {
            formattedPhone = `${formattedPhone}@s.whatsapp.net`;
        }

        const textToSend = message || `رمز التحقق الخاص بك هو: ${otp}`;

        await sock.sendMessage(formattedPhone, { text: textToSend });

        console.log(`✉️ تم إرسال الرسالة بنجاح إلى: ${formattedPhone}`);
        return res.json({ success: true, message: 'تم إرسال الرسالة بنجاح' });
    } catch (error) {
        console.error('❌ خطأ أثناء إرسال الرسالة:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
