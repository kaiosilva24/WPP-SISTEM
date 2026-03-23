const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'src', 'services', 'MessageHandler.js');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Remove MessageMedia and add Baileys helper requirements if needed
content = content.replace(/const { MessageMedia } = require\('whatsapp-web\.js'\);/g, '');

// 2. Fix handleMessage signature to extract msg fields early
content = content.replace(
    /async handleMessage\(msg, session\) \{/,
    `async handleMessage(msg, session) {\n        const msgBody = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || '';\n        const contactId = msg.key.remoteJid;\n        const participant = msg.key.participant || msg.key.remoteJid;\n        const isGroup = contactId.endsWith('@g.us');\n        const hasMedia = !!(msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.audioMessage || msg.message?.documentMessage);\n        `
);

// 3. Replace all msg.body with msgBody
content = content.replace(/msg\.body/g, 'msgBody');

// 4. Replace msg.from with contactId
content = content.replace(/msg\.from/g, 'contactId');

// 5. Replace chat.isGroup evaluation with our isGroup flag
content = content.replace(/const isGroup = .+?;/g, ''); // we already declared it above
content = content.replace(/chat\.isGroup/g, 'isGroup');

// 6. Replace chat accesses
content = content.replace(/const chat = await msg\.getChat\(\);/g, ''); // no longer needed
content = content.replace(/const chatName = chat\.name;/g, 'const chatName = session.store?.contacts[contactId]?.name || contactId;');
content = content.replace(/const contact = await msg\.getContact\(\);/g, 'const contact = session.store?.contacts[participant] || {};');

// 7. Replace contact.pushname / contact.number
content = content.replace(/contact\.pushname/g, '(contact.notify || contact.name)');
content = content.replace(/contact\.number/g, '(contact.id ? contact.id.split("@")[0] : contactId.split("@")[0])');

// 8. Replace sendSeen
content = content.replace(/await chat\.sendSeen\(\);/g, "await session.client.readMessages([msg.key]);");

// 9. Replace Typing/Recording states
content = content.replace(/await chat\.sendStateTyping\(\);/g, "await session.client.sendPresenceUpdate('composing', contactId);");
content = content.replace(/await chat\.sendStateRecording\(\);/g, "await session.client.sendPresenceUpdate('recording', contactId);");
content = content.replace(/await chat\.clearState\(\);/g, "await session.client.sendPresenceUpdate('paused', contactId);");

// 10. Fix getChat, getContact, etc usages where still lurking
// The global find/replace handles most.

// 11. Replace sendText (`session.client.sendMessage(..., text)`)
// Actually `session.sendMessage(contactId, responseText)` -> `session.client.sendMessage(contactId, { text: responseText })`
content = content.replace(/await session\.sendMessage\(([^,]+),\s*([^)]+)\);/g, "await session.client.sendMessage($1, { text: $2 });");

// 12. Fix Media Sending logic in sendMedia method
// Replace base64 conversions and MessageMedia instantiation.
// Old: const media = new MessageMedia(finalMimetype, base64Data, dynamicName);
// Old: await session.client.sendMessage(contactId, media, { sendAudioAsVoice: true });
// New: await session.client.sendMessage(contactId, { audio: sendBuffer, ptt: true, mimetype: finalMimetype });

content = content.replace(
    /const base64Data = sendBuffer\.toString\('base64'\);([\s\S]*?)const media = new MessageMedia\(finalMimetype, base64Data, dynamicName\);\s*try {\s*await session\.client\.sendMessage\(contactId, media, \{ sendAudioAsVoice: true \}\);/g,
    `// Envia Áudio PTT Baileys
            try {
                await session.client.sendMessage(contactId, { audio: sendBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });`
);

content = content.replace(
    /const mediaFallback = new MessageMedia\(finalMimetype, base64Data, dynamicName\);\s*await session\.client\.sendMessage\(contactId, mediaFallback\);/g,
    `await session.client.sendMessage(contactId, { audio: sendBuffer, mimetype: finalMimetype });`
);

content = content.replace(
    /const media = new MessageMedia\(finalMimetype, base64Data, dynamicName\);\s*await session\.client\.sendMessage\(contactId, media, sendOptions\);/g,
    `const msgContent = {};
            if (ext === '.webp') {
                msgContent.sticker = sendBuffer;
                msgContent.mimetype = finalMimetype;
            } else if (isAudio) {
                msgContent.audio = sendBuffer;
                msgContent.mimetype = finalMimetype;
            } else if (ext === '.mp4') {
                msgContent.video = sendBuffer;
                msgContent.mimetype = finalMimetype;
            } else {
                msgContent.image = sendBuffer;
                msgContent.mimetype = finalMimetype;
                msgContent.fileName = dynamicName;
            }
            await session.client.sendMessage(contactId, msgContent);`
);

// 13. Fix doc / vcard sending
content = content.replace(
    /const vcard = new MessageMedia\('text\/vcard', Buffer\.from\(vcfContent\)\.toString\('base64'\), chosen\.name\);\s*await session\.client\.sendMessage\(contactId, vcard\);/g,
    `await session.client.sendMessage(contactId, {
                    contacts: {
                        displayName: chosen.name.replace('.vcf', ''),
                        contacts: [{ vcard: vcfContent }]
                    }
                });`
);

content = content.replace(
    /const media = new MessageMedia\(mimetype, base64Data, `doc_\$\{Date\.now\(\)\}\$\{ext\}`\);\s*await session\.client\.sendMessage\(contactId, media, \{ sendMediaAsDocument: true \}\);/g,
    `await session.client.sendMessage(contactId, { document: fileBuffer, mimetype: mimetype, fileName: chosen.name });`
);

fs.writeFileSync(targetPath, content, 'utf8');
console.log('MessageHandler.js successfully refactored for Baileys!');
