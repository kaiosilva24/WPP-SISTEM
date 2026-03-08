const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { config } = require('../config');

// Rota para ler os logs mais recentes (hoje)
router.get('/', (req, res) => {
    try {
        const logFolder = config.logs.folder;
        if (!fs.existsSync(logFolder)) {
            return res.status(404).json({ error: 'Pasta de logs não encontrada' });
        }

        const date = new Date().toISOString().split('T')[0];
        const logFile = path.join(logFolder, `${date}.log`);

        if (!fs.existsSync(logFile)) {
            return res.status(404).json({ error: `Arquivo de log de hoje (${date}) não encontrado` });
        }

        // Lê as últimas N linhas (padrão 500)
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.split('\n').filter(Boolean);
        const limit = parseInt(req.query.limit) || 1000;

        const recentLines = lines.slice(-limit);

        res.json({
            date,
            totalLines: lines.length,
            returnedLines: recentLines.length,
            logs: recentLines
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao ler logs: ' + error.message });
    }
});

module.exports = router;
