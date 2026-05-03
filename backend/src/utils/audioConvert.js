const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

/**
 * Converte qualquer áudio (mp3/m4a/wav/ogg) para OGG/Opus,
 * que é o formato exigido pelo WhatsApp pra PTT (voice note) tocar no mobile.
 *
 * Estratégia:
 * - Se o arquivo já é .ogg, retorna ele mesmo (assumimos opus).
 * - Caso contrário, converte via ffmpeg e cacheia em `.opus_cache_<base>.ogg`
 *   ao lado do original. Re-uso instantâneo nas próximas chamadas.
 * - Cache é prefixado com `.` (dot) — nosso `_collectMediaCandidates` já ignora
 *   arquivos que começam com `.`, então o cache não vira candidato pro sorteio.
 */

let _ffmpegCheck = null;

function isFFmpegAvailable() {
    if (_ffmpegCheck !== null) return _ffmpegCheck;
    _ffmpegCheck = new Promise((resolve) => {
        execFile('ffmpeg', ['-version'], { timeout: 5000 }, (err) => {
            resolve(!err);
        });
    });
    return _ffmpegCheck;
}

function _runFfmpeg(args, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        execFile('ffmpeg', args, { timeout: timeoutMs }, (err, stdout, stderr) => {
            if (err) {
                err.stderr = stderr;
                reject(err);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

/**
 * Garante uma versão OGG/Opus do arquivo de áudio.
 * Lança erro se ffmpeg não está disponível ou conversão falhou.
 */
async function ensureOggOpus(srcPath) {
    if (!srcPath) throw new Error('srcPath vazio');

    if (srcPath.toLowerCase().endsWith('.ogg')) return srcPath;

    if (!(await isFFmpegAvailable())) {
        throw new Error('ffmpeg não disponível no sistema');
    }

    const ext = path.extname(srcPath);
    const dir = path.dirname(srcPath);
    const base = path.basename(srcPath, ext);
    const dest = path.join(dir, `.opus_cache_${base}.ogg`);

    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
        return dest;
    }

    const args = [
        '-y',
        '-loglevel', 'error',
        '-i', srcPath,
        '-vn',
        '-c:a', 'libopus',
        '-b:a', '32k',
        '-vbr', 'on',
        '-compression_level', '10',
        '-application', 'voip',
        '-ac', '1',
        '-ar', '48000',
        dest
    ];

    try {
        await _runFfmpeg(args);
    } catch (e) {
        try { fs.unlinkSync(dest); } catch (_) {}
        throw new Error(`ffmpeg falhou: ${e.message} ${e.stderr ? '| ' + String(e.stderr).slice(0, 200) : ''}`);
    }

    if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
        try { fs.unlinkSync(dest); } catch (_) {}
        throw new Error('ffmpeg não gerou saída válida');
    }
    return dest;
}

module.exports = { ensureOggOpus, isFFmpegAvailable };
