const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());

let sock;
let latestQR = '';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            latestQR = qr;
            console.log('⚡ تم توليد رمز QR جديد، افتح الرابط /qr في المتصفح لمسحه.');
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            latestQR = '';
            console.log('✅ تم الاتصال بواتساب الشركة بنجاح وجاهز لإرسال الرسائل!');
        }
    });
}

// صفحة عرض الـ QR كصورة واضحة ومباشرة
app.get('/qr', (req, res) => {
    if (!latestQR) {
        return res.send(`
            <div style="text-align: center; font-family: sans-serif; padding: 50px;">
                <h2>✅ السيرفر متصل بالواتساب بالفعل أو جاري التجهيز...</h2>
                <p>إذا لم تكن متصلاً، انتظر بضع ثوانٍ وأعد تحديث الصفحة (Refresh).</p>
            </div>
        `);
    }

    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQR)}`;

    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>مسح رمز الواتساب</title>
            <style>
                body { font-family: system-ui, sans-serif; background: #f4f6f8; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
                img { border: 8px solid #25D366; border-radius: 12px; margin: 20px 0; }
                h2 { color: #128C7E; margin-top: 0; }
                p { color: #555; font-size: 14px; line-height: 1.6; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>امسح الرمز من واتساب الشركة</h2>
                <p>افتح الواتساب 👈 الأجهزة المرتبطة 👈 ربط جهاز 👈 وجه الكاميرا للشاشة:</p>
                <img src="${qrImageUrl}" alt="WhatsApp QR Code" />
                <p style="font-size:12px; color:#888;">يتحدث الرمز تلقائياً عند إعادة تحميل الصفحة.</p>
            </div>
        </body>
        </html>
    `);
});

// استقبال طلبات إرسال الـ OTP
app.post('/send-otp', async (req, res) => {
    const { phone, otp, lang } = req.body;

    if (!phone || !otp) {
        return res.status(400).json({ success: false, message: 'رقم الهاتف والرمز مطلوبان' });
    }

    let formattedPhone = phone.replace(/[^0-9]/g, '');
    if (formattedPhone.startsWith('05')) {
        formattedPhone = '966' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('5')) {
        formattedPhone = '966' + formattedPhone;
    }
    
    const jid = `${formattedPhone}@s.whatsapp.net`;

    const messages = {
        ar: `🚚 *شركة المسار المميز للخدمات اللوجستية*\n\nرمز التحقق الخاص بك هو: *${otp}*\n\nيرجى إدخاله في التطبيق لإكمال تسجيل الدخول. لا تشارك هذا الرمز مع أي شخص.`,
        en: `🚚 *Al-Masar Al-Mumayaz Logistics*\n\nYour verification code is: *${otp}*\n\nPlease enter it in the app to complete login. Do not share this code with anyone.`,
        ur: `🚚 *المسار المميز لاجسٹکس*\n\nآپ کا تصدیقی کوڈ ہے: *${otp}*`,
        hi: `🚚 *अल-मसार अल-मुमय्याज़ लॉजिस्टिक्स*\n\nआपका सत्यापन कोड है: *${otp}*`,
        bn: `🚚 *আল-মাসার আল-মুমায়্যাজ লজিস্টিকস*\n\nআপনার যাচাইকরণ কোড হল: *${otp}*`
    };

    const textMessage = messages[lang] || messages['ar'];

    try {
        if (!sock) {
            return res.status(500).json({ success: false, message: 'سيرفر الواتساب غير متصل حالياً' });
        }
        await sock.sendMessage(jid, { text: textMessage });
        res.json({ success: true, message: 'تم إرسال OTP بنجاح عبر الواتساب' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    connectToWhatsApp();
});
