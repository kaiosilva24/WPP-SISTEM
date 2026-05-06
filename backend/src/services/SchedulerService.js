const db = require('../database/DatabaseManager');
const sessionManager = require('./SessionManager');
const logger = require('../utils/logger');

/**
 * Scheduler de pause/resume automático por janela horária.
 *
 * A cada minuto, varre todas as contas com `schedule_enabled = true` em todos os
 * tenants ativos e checa se o horário atual está dentro da janela
 * [scheduled_start_time, scheduled_end_time] (formato 'HH:MM' de HTML <input type="time">).
 *
 * - DENTRO da janela e conta status='paused'|'disconnected'|'error' → cria sessão (resume)
 * - FORA  da janela e conta status='ready'|'authenticated' → destrói sessão (pause)
 *
 * Janela que cruza meia-noite é suportada (ex: 22:00–06:00 = das 22h até 6h do dia seguinte).
 *
 * Convenção: quando schedule_enabled=false a conta é ignorada totalmente — o usuário
 * controla manualmente via botões Iniciar/Pausar do painel.
 */
class SchedulerService {
    constructor() {
        this.timer = null;
        this.tickInProgress = false;
        this.intervalMs = 60 * 1000; // 1 min
        this.lastDecisionAt = new Map(); // `${tenantId}:${accountId}` -> ts ms (anti-flap)
        this.minIntervalBetweenActions = 90 * 1000; // não toma 2 ações na mesma conta em <90s
    }

    start() {
        if (this.timer) return;
        // Roda uma vez logo após boot e depois a cada minuto
        setTimeout(() => this._tickSafe(), 5000);
        this.timer = setInterval(() => this._tickSafe(), this.intervalMs);
        logger.info(null, '⏰ SchedulerService iniciado (sweep a cada 60s)');
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    async _tickSafe() {
        if (this.tickInProgress) return;
        this.tickInProgress = true;
        try {
            await this._tick();
        } catch (e) {
            logger.error(null, `Scheduler tick erro: ${e.message}`);
        } finally {
            this.tickInProgress = false;
        }
    }

    async _tick() {
        const tenants = await db.listTenants().catch(() => []);
        if (!tenants || !tenants.length) return;

        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();

        for (const t of tenants) {
            if (t.status && t.status !== 'active') continue;
            const tdb = db.tenant(t.id);
            let accounts = [];
            try { accounts = await tdb.getAllAccounts(); } catch (_) { continue; }

            for (const acc of accounts) {
                if (!acc.schedule_enabled) continue;
                const start = parseHHMM(acc.scheduled_start_time);
                const end = parseHHMM(acc.scheduled_end_time);
                if (start == null || end == null) continue;
                if (start === end) continue; // ambíguo, ignora

                const inWindow = isInWindow(nowMinutes, start, end);
                const decisionKey = `${t.id}:${acc.id}`;
                const lastAt = this.lastDecisionAt.get(decisionKey) || 0;
                if (Date.now() - lastAt < this.minIntervalBetweenActions) continue;

                const session = sessionManager.getSession(t.id, acc.id);
                const sessStatus = session ? session.status : null;

                try {
                    if (inWindow) {
                        // Deve estar rodando. Se não tem sessão ou está em estado parado, sobe.
                        if (!session || ['destroyed', 'error', 'logged_out'].includes(sessStatus)
                            || ['paused', 'disconnected', 'error'].includes(acc.status)) {
                            logger.info(acc.name, `⏰ janela ${acc.scheduled_start_time}-${acc.scheduled_end_time} ABRIU → iniciando sessão`);
                            // Limpa eventual sessão zumbi do bucket antes de criar nova
                            if (session && ['destroyed', 'error', 'logged_out'].includes(sessStatus)) {
                                try { await sessionManager.destroySession(t.id, acc.id); } catch (_) {}
                            }
                            await sessionManager.createSession(t.id, acc.id, acc.name, {});
                            this.lastDecisionAt.set(decisionKey, Date.now());
                        }
                    } else {
                        // FORA da janela. Se está rodando/conectando, pausa.
                        if (session && ['ready', 'authenticated', 'connecting', 'qr', 'initializing'].includes(sessStatus)) {
                            logger.info(acc.name, `⏰ janela ${acc.scheduled_start_time}-${acc.scheduled_end_time} FECHOU → pausando sessão`);
                            await sessionManager.destroySession(t.id, acc.id);
                            try { await tdb.updateAccountStatus(acc.id, 'paused'); } catch (_) {}
                            this.lastDecisionAt.set(decisionKey, Date.now());
                        }
                    }
                } catch (e) {
                    logger.error(acc.name, `Scheduler ação falhou (inWindow=${inWindow}): ${e.message}`);
                }
            }
        }
    }
}

/** Converte 'HH:MM' em minutos desde 00:00, ou null se inválido. */
function parseHHMM(s) {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (isNaN(h) || isNaN(mm)) return null;
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
}

/**
 * `nowMin` está dentro de [startMin, endMin)?
 * Se start <= end, janela é simples no mesmo dia.
 * Se start > end, janela cruza meia-noite (ex: 22:00–06:00).
 */
function isInWindow(nowMin, startMin, endMin) {
    if (startMin <= endMin) {
        return nowMin >= startMin && nowMin < endMin;
    }
    return nowMin >= startMin || nowMin < endMin;
}

const scheduler = new SchedulerService();
module.exports = scheduler;
