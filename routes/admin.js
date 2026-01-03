/**
 * Роуты админ-панели
 */

const express = require('express');
const { pool } = require('../config/database');
const { requireAdmin, requireAdminAPI } = require('../middleware/auth');

const router = express.Router();

/**
 * Логирование действий админа
 */
async function logAdminAction(adminId, action, targetType, targetId, details) {
    try {
        await pool.execute(
            'INSERT INTO admin_logs (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
            [adminId, action, targetType, targetId, details]
        );
    } catch (error) {
        console.error('Ошибка логирования:', error);
    }
}

// ====== GET /admin — Главная страница админки ======
router.get('/admin', requireAdmin, async (req, res) => {
    try {
        // Статистика
        const [usersCount] = await pool.execute('SELECT COUNT(*) as count FROM users');
        const [videosCount] = await pool.execute('SELECT COUNT(*) as count FROM videos');
        const [bannedCount] = await pool.execute('SELECT COUNT(*) as count FROM users WHERE is_banned = TRUE');
        const [ipBansCount] = await pool.execute('SELECT COUNT(*) as count FROM ip_bans');

        // Последние пользователи
        const [recentUsers] = await pool.execute(`
            SELECT id, username, email, avatar, is_admin, is_banned, last_ip, created_at 
            FROM users 
            ORDER BY created_at DESC 
            LIMIT 10
        `);

        // Последние видео
        const [recentVideos] = await pool.execute(`
            SELECT v.*, u.username 
            FROM videos v
            JOIN users u ON v.user_id = u.id
            ORDER BY v.created_at DESC 
            LIMIT 10
        `);

        // Последние действия админов
        const [adminLogs] = await pool.execute(`
            SELECT al.*, u.username as admin_name
            FROM admin_logs al
            JOIN users u ON al.admin_id = u.id
            ORDER BY al.created_at DESC
            LIMIT 20
        `);

        // Забаненные IP
        const [ipBans] = await pool.execute(`
            SELECT ib.*, u.username as banned_by_name
            FROM ip_bans ib
            JOIN users u ON ib.banned_by = u.id
            ORDER BY ib.created_at DESC
        `);

        res.render('admin/dashboard', {
            stats: {
                users: usersCount[0].count,
                videos: videosCount[0].count,
                banned: bannedCount[0].count,
                ipBans: ipBansCount[0].count
            },
            recentUsers,
            recentVideos,
            adminLogs,
            ipBans
        });

    } catch (error) {
        console.error('Ошибка админки:', error);
        res.status(500).send('Ошибка сервера');
    }
});

// ====== GET /admin/users — Управление пользователями ======
router.get('/admin/users', requireAdmin, async (req, res) => {
    try {
        const search = req.query.search || '';
        
        let query = `
            SELECT u.*, 
                   (SELECT COUNT(*) FROM videos WHERE user_id = u.id) as videos_count,
                   (SELECT COUNT(*) FROM subscriptions WHERE channel_id = u.id) as subs_count
            FROM users u
        `;
        let params = [];

        if (search) {
            query += ' WHERE u.username LIKE ? OR u.email LIKE ? OR u.last_ip LIKE ?';
            params = [`%${search}%`, `%${search}%`, `%${search}%`];
        }

        query += ' ORDER BY u.created_at DESC';

        const [users] = await pool.execute(query, params);

        res.render('admin/users', { users, search });

    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).send('Ошибка сервера');
    }
});

// ====== GET /admin/user/:id — Детали пользователя ======
router.get('/admin/user/:id', requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;

        // Данные пользователя
        const [users] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).render('404', { message: 'Пользователь не найден' });
        }

        const user = users[0];

        // Все IP адреса пользователя
        const [ips] = await pool.execute(
            'SELECT DISTINCT ip_address, MIN(created_at) as first_seen, MAX(created_at) as last_seen FROM user_ips WHERE user_id = ? GROUP BY ip_address ORDER BY last_seen DESC',
            [userId]
        );

        // Видео пользователя
        const [videos] = await pool.execute(
            'SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );

        // Аккаунты с такими же IP (мультиаккаунты)
        const [relatedAccounts] = await pool.execute(`
            SELECT DISTINCT u.id, u.username, u.email, u.is_banned, ui.ip_address
            FROM users u
            JOIN user_ips ui ON u.id = ui.user_id
            WHERE ui.ip_address IN (SELECT ip_address FROM user_ips WHERE user_id = ?)
            AND u.id != ?
        `, [userId, userId]);

        res.render('admin/user-details', { 
            targetUser: user, 
            ips, 
            videos,
            relatedAccounts
        });

    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).send('Ошибка сервера');
    }
});

// ====== POST /admin/user/:id/ban — Бан пользователя ======
router.post('/admin/user/:id/ban', requireAdminAPI, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { reason, banIP } = req.body;

        if (userId === req.user.id) {
            return res.status(400).json({ error: 'Нельзя забанить себя' });
        }

        const [users] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        const targetUser = users[0];

        if (targetUser.is_admin) {
            return res.status(403).json({ error: 'Нельзя забанить администратора' });
        }

        await pool.execute(
            'UPDATE users SET is_banned = TRUE, ban_reason = ? WHERE id = ?',
            [reason || 'Нарушение правил', userId]
        );

        if (banIP && targetUser.last_ip) {
            await pool.execute(
                'INSERT IGNORE INTO ip_bans (ip_address, reason, banned_by) VALUES (?, ?, ?)',
                [targetUser.last_ip, reason || 'Нарушение правил', req.user.id]
            );
        }

        await logAdminAction(
            req.user.id, 
            'BAN_USER', 
            'user', 
            userId, 
            JSON.stringify({ username: targetUser.username, reason, banIP })
        );

        res.json({ success: true, message: 'Пользователь забанен' });

    } catch (error) {
        console.error('Ошибка бана:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ====== POST /admin/user/:id/unban — Разбан пользователя ======
router.post('/admin/user/:id/unban', requireAdminAPI, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        await pool.execute(
            'UPDATE users SET is_banned = FALSE, ban_reason = NULL WHERE id = ?',
            [userId]
        );

        await logAdminAction(req.user.id, 'UNBAN_USER', 'user', userId, null);

        res.json({ success: true, message: 'Пользователь разбанен' });

    } catch (error) {
        console.error('Ошибка разбана:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ====== POST /admin/ip/ban — Бан IP адреса ======
router.post('/admin/ip/ban', requireAdminAPI, async (req, res) => {
    try {
        const { ip, reason } = req.body;

        if (!ip) return res.status(400).json({ error: 'IP адрес обязателен' });

        await pool.execute(
            'INSERT IGNORE INTO ip_bans (ip_address, reason, banned_by) VALUES (?, ?, ?)',
            [ip, reason || 'Нарушение правил', req.user.id]
        );

        await logAdminAction(req.user.id, 'BAN_IP', 'ip', null, JSON.stringify({ ip, reason }));

        res.json({ success: true, message: 'IP забанен' });

    } catch (error) {
        console.error('Ошибка бана IP:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ====== DELETE /admin/ip/ban/:ip — Разбан IP ======
router.delete('/admin/ip/ban/:ip', requireAdminAPI, async (req, res) => {
    try {
        const ip = decodeURIComponent(req.params.ip);

        await pool.execute('DELETE FROM ip_bans WHERE ip_address = ?', [ip]);

        await logAdminAction(req.user.id, 'UNBAN_IP', 'ip', null, JSON.stringify({ ip }));

        res.json({ success: true, message: 'IP разбанен' });

    } catch (error) {
        console.error('Ошибка разбана IP:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ====== POST /admin/user/:id/toggle-admin — Выдать права админа ======
router.post('/admin/user/:id/toggle-admin', requireAdminAPI, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        if (userId === req.user.id) return res.status(400).json({ error: 'Нельзя изменить свои права' });
        
        // Только главный админ может назначать других
        if (req.user.username !== 'Today_AIDK') {
            return res.status(403).json({ error: 'Только главный админ может назначать администраторов' });
        }

        const [users] = await pool.execute('SELECT is_admin FROM users WHERE id = ?', [userId]);
        if (users.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });

        const newStatus = !users[0].is_admin;

        await pool.execute('UPDATE users SET is_admin = ? WHERE id = ?', [newStatus, userId]);

        await logAdminAction(
            req.user.id, 
            newStatus ? 'GRANT_ADMIN' : 'REVOKE_ADMIN', 
            'user', 
            userId, 
            null
        );

        res.json({ success: true, isAdmin: newStatus });

    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// 3. Список видео (ИСПРАВЛЯЕТ ВАШУ ОШИБКУ 404)
router.get('/admin/videos', requireAdmin, async (req, res) => {
    try {
        const search = req.query.search || '';
        let query = `
            SELECT v.*, u.username 
            FROM videos v 
            JOIN users u ON v.user_id = u.id
        `;
        let params = [];

        if (search) {
            query += ' WHERE v.title LIKE ? OR u.username LIKE ?';
            params = [`%${search}%`, `%${search}%`];
        }
        query += ' ORDER BY v.created_at DESC LIMIT 50';

        const [videos] = await pool.execute(query, params);
        res.render('admin/videos', { videos, search });
    } catch (error) {
        console.error(error);
        res.status(500).send('Ошибка видео');
    }
});

// 4. Детали пользователя
router.get('/admin/user/:id', requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Данные юзера
        const [users] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
        if (users.length === 0) return res.status(404).render('404');
        const user = users[0];
        
        // Видео
        const [videos] = await pool.execute('SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC', [userId]);
        
        // IP
        const [ips] = await pool.execute('SELECT DISTINCT ip_address, created_at as first_seen, created_at as last_seen FROM user_ips WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [userId]);
        
        // Мультиаккаунты
        const [relatedAccounts] = await pool.execute(`
            SELECT DISTINCT u.id, u.username, u.email, u.is_banned, ui.ip_address 
            FROM users u 
            JOIN user_ips ui ON u.id = ui.user_id 
            WHERE ui.ip_address IN (SELECT ip_address FROM user_ips WHERE user_id = ?) 
            AND u.id != ?
        `, [userId, userId]);

        // РЕНДЕР: передаем relatedAccounts именно под этим именем!
        res.render('admin/user-details', { 
            targetUser: user, 
            videos, 
            ips, 
            relatedAccounts: relatedAccounts // <--- Имя совпадает с EJS
        });

    } catch (error) {
        console.error(error);
        res.status(500).send('Ошибка профиля');
    }
});

// Добавьте это в конец routes/admin.js перед module.exports

router.post('/admin/video/:id/reactions', requireAdminAPI, async (req, res) => {
    try {
        const { likes, dislikes } = req.body;
        const videoId = req.params.id;

        await pool.execute('UPDATE videos SET likes = likes + ?, dislikes = dislikes + ? WHERE id = ?', 
            [likes, dislikes, videoId]);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

router.post('/admin/user/:id/subscribers', requireAdminAPI, async (req, res) => {
    try {
        const { count } = req.body;
        await pool.execute('UPDATE users SET subscribers_count = subscribers_count + ? WHERE id = ?', 
            [count, req.params.id]);
        
        const [u] = await pool.execute('SELECT subscribers_count FROM users WHERE id = ?', [req.params.id]);
        res.json({ subscribers: u[0].subscribers_count });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка' });
    }
});

module.exports = router;