// server/whatsapp/config.js
// Configuração da integração com o WhatsApp Business (API oficial da Meta, "Cloud API").
//
// Duas coisas separadas, de propósito:
//  - SEGREDOS e ligações com a Meta ficam em VARIÁVEIS DE AMBIENTE (na Railway: aba Variables).
//    Nunca no banco, nunca no código, nunca numa tela: quem abrir o portal não consegue ver o token.
//  - AJUSTES do dia a dia (ligar/desligar, número que recebe os alertas, nomes dos modelos) ficam na
//    tabela "settings" e são editados na página "WhatsApp" do portal.

const { db } = require('../db');

const DEFAULTS = {
  'wa.enabled': '0', // desligado até a administração ligar: publicar a atualização nunca dispara mensagens
  'wa.admin_phone': '',
  'wa.template_confirm': 'olimais_confirmacao_aula',
  'wa.template_alert': 'olimais_alerta_cancelamento',
  'wa.language': 'pt_BR',
  'wa.ack': '1', // responder "Obrigado, aula confirmada" quando o responsável toca num botão
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== undefined ? row.value : DEFAULTS[key];
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// Lê as variáveis de ambiente a cada uso (assim os testes podem trocá-las e nada fica "congelado").
function env() {
  const get = (name) => String(process.env[name] || '').trim();
  const phoneNumberId = get('WHATSAPP_PHONE_NUMBER_ID');
  const wabaId = get('WHATSAPP_WABA_ID');
  return {
    token: get('WHATSAPP_TOKEN'),
    phoneNumberId: /^\d{5,25}$/.test(phoneNumberId) ? phoneNumberId : '',
    phoneNumberIdRaw: phoneNumberId,
    appSecret: get('WHATSAPP_APP_SECRET'),
    verifyToken: get('WHATSAPP_VERIFY_TOKEN'),
    wabaId: /^\d{5,25}$/.test(wabaId) ? wabaId : '',
    apiVersion: /^v\d+\.\d+$/.test(get('WHATSAPP_API_VERSION')) ? get('WHATSAPP_API_VERSION') : 'v25.0',
    // Só para testes (uma "Meta falsa" local). Em produção fica o endereço oficial.
    apiBase: (get('WA_API_BASE') || 'https://graph.facebook.com').replace(/\/+$/, ''),
  };
}

function credentialsReady() {
  const e = env();
  return !!(e.token && e.phoneNumberId);
}

// Ligado = a administração ligou na página WhatsApp E o token e o número existem.
function isEnabled() {
  return getSetting('wa.enabled') === '1' && credentialsReady();
}

function settings() {
  return {
    enabled: getSetting('wa.enabled') === '1',
    adminPhone: getSetting('wa.admin_phone'),
    templateConfirm: getSetting('wa.template_confirm'),
    templateAlert: getSetting('wa.template_alert'),
    language: getSetting('wa.language'),
    ack: getSetting('wa.ack') === '1',
  };
}

module.exports = { DEFAULTS, getSetting, setSetting, env, credentialsReady, isEnabled, settings };
