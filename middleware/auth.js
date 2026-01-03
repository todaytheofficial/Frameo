/**
 * middleware/auth.js
 * Логика авторизации и проверки прав
 */

const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

/**
 * Получить IP адрес клиента
 */
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.headers['x-real-ip'] || 
           req.connection?.remoteAddress || 
           req.socket?.remoteAddress ||
           req.ip ||
           'unknown';
}

/**
 * Middleware: Проверка токена (для всех страниц)
 * Добавляет req.user, если пользователь авторизован.
 * Не блокирует доступ, если не авторизован (просто req.user = null).
 */
async function authMiddleware(req, res, next) {
    try {
        const clientIP = getClientIP(req);
        req.clientIP = clientIP;

        // 1. Проверяем IP бан
        const [bannedIPs] = await pool.execute(
            'SELECT * FROM ip_bans WHERE ip_address = ?',
            [clientIP]
        );

        if (bannedIPs.length > 0) {
            return res.status(403).render('banned', { 
                reason: bannedIPs[0].reason,
                type: 'ip'
            });
        }

        const token = req.cookies.token;
        
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // 2. Получаем пользователя
            const [users] = await pool.execute(
                'SELECT id, username, email, avatar, subscribers_count, is_admin, is_banned, ban_reason FROM users WHERE id = ?',
                [decoded.userId]
            );
            
            if (users.length > 0) {
                const user = users[0];

                // 3. Проверяем бан аккаунта
                if (user.is_banned) {
                    res.clearCookie('token');
                    return res.status(403).render('banned', { 
                        reason: user.ban_reason || 'Нарушение правил',
                        type: 'account'
                    });
                }

                req.user = user;

                // 4. Логируем IP (без await, чтобы не тормозить запрос)
                pool.execute(
                    'INSERT IGNORE INTO user_ips (user_id, ip_address) VALUES (?, ?)',
                    [user.id, clientIP]
                ).catch(() => {});
                
                pool.execute(
                    'UPDATE users SET last_ip = ? WHERE id = ?',
                    [clientIP, user.id]
                ).catch(() => {});
            }
        }
    } catch (error) {
        // Если токен неверный, просто сбрасываем его
        res.clearCookie('token');
    }
    
    // Передаем пользователя в шаблоны (для EJS)
    res.locals.user = req.user || null;
    next();
}

/**
 * Middleware: Требует авторизацию
 * Если не авторизован -> редирект на /login
 */
function requireAuth(req, res, next) {
    if (!req.user) {
        return res.redirect('/login');
    }
    next();
}

/**
 * Middleware: Требует права администратора (для страниц)
 */
function requireAdmin(req, res, next) {
    if (!req.user || !req.user.is_admin) {
        return res.status(403).render('403', { message: 'Нужны права администратора' });
    }
    next();
}

/**
 * Middleware: Требует права администратора (для API запросов)
 */
function requireAdminAPI(req, res, next) {
    if (!req.user || !req.user.is_admin) {
        return res.status(403).json({ error: 'Нужны права администратора' });
    }
    next();
}

// ЭКСПОРТ (Самое важное - убедитесь, что requireAuth здесь есть)
module.exports = { 
    authMiddleware, 
    requireAuth, 
    requireAdmin,
    requireAdminAPI,
    getClientIP
};