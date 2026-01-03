/**
 * Роуты каналов и Creative Studio
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Настройка загрузки аватаров
const avatarStorage = multer.diskStorage({
    destination: './public/uploads/avatars/',
    filename: (req, file, cb) => {
        cb(null, `avatar_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`);
    }
});
const uploadAvatar = multer({ storage: avatarStorage });

// GET /channel/@username/userid — страница канала
router.get('/channel/@:username/:userId', async (req, res) => {
    try {
        const { username, userId } = req.params;
        
        // Получаем данные канала
        const [users] = await pool.execute(
            'SELECT id, username, avatar, subscribers_count, created_at FROM users WHERE id = ? AND username = ?',
            [userId, username]
        );
        
        if (users.length === 0) {
            return res.status(404).render('404', { message: 'Канал не найден' });
        }
        
        const channel = users[0];
        
        // Получаем видео канала
        const [videos] = await pool.execute(
            'SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );
        
        // Проверяем, это мой канал или чужой
        const isOwner = req.user && req.user.id === parseInt(userId);
        
        // Проверяем подписку
        let isSubscribed = false;
        if (req.user && !isOwner) {
            const [subs] = await pool.execute(
                'SELECT id FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?',
                [req.user.id, userId]
            );
            isSubscribed = subs.length > 0;
        }
        
        res.render('channel', {
            channel,
            videos,
            isOwner,
            isSubscribed
        });
        
    } catch (error) {
        console.error('Ошибка загрузки канала:', error);
        res.status(500).send('Ошибка сервера');
    }
});

// POST /channel/subscribe/:userId — подписка/отписка
router.post('/channel/subscribe/:userId', requireAuth, async (req, res) => {
    try {
        const channelId = parseInt(req.params.userId);
        
        // Нельзя подписаться на себя
        if (req.user.id === channelId) {
            return res.status(400).json({ error: 'Нельзя подписаться на себя' });
        }
        
        // Проверяем есть ли подписка
        const [existing] = await pool.execute(
            'SELECT id FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?',
            [req.user.id, channelId]
        );
        
        if (existing.length > 0) {
            // Отписываемся
            await pool.execute(
                'DELETE FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?',
                [req.user.id, channelId]
            );
            await pool.execute(
                'UPDATE users SET subscribers_count = subscribers_count - 1 WHERE id = ?',
                [channelId]
            );
            res.json({ subscribed: false });
        } else {
            // Подписываемся
            await pool.execute(
                'INSERT INTO subscriptions (subscriber_id, channel_id) VALUES (?, ?)',
                [req.user.id, channelId]
            );
            await pool.execute(
                'UPDATE users SET subscribers_count = subscribers_count + 1 WHERE id = ?',
                [channelId]
            );
            res.json({ subscribed: true });
        }
        
    } catch (error) {
        console.error('Ошибка подписки:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// GET /studio — Creative Studio
router.get('/studio', requireAuth, async (req, res) => {
    try {
        // Получаем все видео пользователя
        const [videos] = await pool.execute(
            'SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC',
            [req.user.id]
        );
        
        // Считаем статистику
        const [stats] = await pool.execute(`
            SELECT 
                COALESCE(SUM(views), 0) as totalViews,
                COALESCE(SUM(likes), 0) as totalLikes,
                COALESCE(SUM(dislikes), 0) as totalDislikes
            FROM videos WHERE user_id = ?
        `, [req.user.id]);
        
        // Считаем комментарии
        const [comments] = await pool.execute(`
            SELECT COUNT(*) as totalComments 
            FROM comments c
            JOIN videos v ON c.video_id = v.id
            WHERE v.user_id = ?
        `, [req.user.id]);
        
        res.render('studio', {
            videos,
            stats: stats[0],
            totalComments: comments[0].totalComments
        });
        
    } catch (error) {
        console.error('Ошибка Studio:', error);
        res.status(500).send('Ошибка сервера');
    }
});

// POST /studio/avatar — обновление аватара
router.post('/studio/avatar', requireAuth, uploadAvatar.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.redirect('/studio');
        }
        
        await pool.execute(
            'UPDATE users SET avatar = ? WHERE id = ?',
            [req.file.filename, req.user.id]
        );
        
        res.redirect('/studio');
        
    } catch (error) {
        console.error('Ошибка загрузки аватара:', error);
        res.redirect('/studio');
    }
});

module.exports = router;