const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(cors());
app.use(express.json());

let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n============== امسح الكود التالي من واتساب جوال الشركة ==============\n');
            qrcode.generate(qr, { small: true });
            console.log('\n====================================================================\n');
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ تم الاتصال بواتساب الشركة بنجاح وجاهز لإرسال الرسائل!');
        }
    });
}

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
