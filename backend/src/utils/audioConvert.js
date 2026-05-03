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
 *
 * O binário do ffmpeg vem do pacote npm `ffmpeg-static` (~70MB no node_modules
 * com binário pré-compilado pra Linux/macOS/Windows). Isso elimina dependência
 * do `APT=ffmpeg` do Discloud, que não estava sendo aplicado.
 */

let _ffmpegPath = null;
function getFfmpegPath() {
    if (_ffmpegPath) return _ffmpegPath;
    try {
        const p = require('ffmpeg-static');
        if (p && fs.existsSync(p)) {
            _ffmpegPath = p;
            return p;
        }
    } catch (_) {}
    // Fallback: ffmpeg do PATH do sistema (desenvolvimento local)
    _ffmpegPath = 'ffmpeg';
    return _ffmpegPath;
}

let _ffmpegCheck = null;
function isFFmpegAvailable() {
    if (_ffmpegCheck !== null) return _ffmpegCheck;
    _ffmpegCheck = new Promise((resolve) => {
        const ffmpeg = getFfmpegPath();
        execFile(ffmpeg, ['-version'], { timeout: 5000 }, (err) => {
            if (err) {
                console.warn(`[audioConvert] ffmpeg não disponível em "${ffmpeg}": ${err.message}`);
                resolve(false);
            } else {
                console.log(`[audioConvert] ffmpeg disponível em: ${ffmpeg}`);
                resolve(true);
            }
        });
    });
    return _ffmpegCheck;
}

function _runFfmpeg(args, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        execFile(getFfmpegPath(), args, { timeout: timeoutMs }, (err, stdout, stderr) => {
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

/**
 * Retorna a duração do áudio em segundos (ou null se não conseguir).
 *
 * Como `ffmpeg-static` NÃO inclui o ffprobe, usamos o próprio ffmpeg em modo
 * "null muxer" lendo o input pra fazer ele imprimir Duration no stderr, e
 * parseamos. Funciona com qualquer ffmpeg moderno.
 */
function getAudioDuration(filePath) {
    return new Promise((resolve) => {
        execFile(getFfmpegPath(), ['-i', filePath, '-f', 'null', '-'],
            { timeout: 10000 }, (err, _stdout, stderr) => {
                // ffmpeg nesse modo retorna exit-code != 0 (porque output é null), mas
                // ainda imprime o Duration no stderr. Não tratamos err como fatal.
                const text = String(stderr || '');
                const m = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
                if (!m) return resolve(null);
                const h = parseInt(m[1], 10) || 0;
                const mn = parseInt(m[2], 10) || 0;
                const s = parseFloat(m[3]) || 0;
                const dur = h * 3600 + mn * 60 + s;
                resolve(dur > 0 ? dur : null);
            });
    });
}

module.exports = { ensureOggOpus, isFFmpegAvailable, getAudioDuration };
