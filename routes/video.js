/**
 * Роуты для видео: загрузка, просмотр, лайки, комментарии
 * С защитой от накрутки и реалтаймом
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Настройка загрузки видео
const videoStorage = multer.diskStorage({
    destination: './public/uploads/videos/',
    filename: (req, file, cb) => {
        cb(null, `video_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({ 
    storage: videoStorage,
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['.mp4', '.webm', '.mov', '.avi'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Недопустимый формат видео'));
        }
    }
});

// GET /upload — страница загрузки
router.get('/upload', requireAuth, (req, res) => {
    res.render('upload', { error: null });
});

// POST /upload — загрузка видео
router.post('/upload', requireAuth, upload.single('video'), async (req, res) => {
    try {
        const { title, description } = req.body;
        
        if (!req.file || !title) {
            return res.render('upload', { error: 'Заполните все обязательные поля' });
        }
        
        await pool.execute(
            'INSERT INTO videos (user_id, title, description, filename) VALUES (?, ?, ?, ?)',
            [req.user.id, title, description || '', req.file.filename]
        );
        
        res.redirect(`/channel/@${req.user.username}/${req.user.id}`);
        
    } catch (error) {
        console.error('Ошибка загрузки видео:', error);
        res.render('upload', { error: 'Ошибка загрузки' });
    }
});

// GET /watch/:id — просмотр видео
router.get('/watch/:id', async (req, res) => {
    try {
        const videoId = req.params.id;
        
        // Получаем видео
        const [videos] = await pool.execute(`
            SELECT v.*, u.username, u.avatar, u.subscribers_count
            FROM videos v
            JOIN users u ON v.user_id = u.id
            WHERE v.id = ?
        `, [videoId]);
        
        if (videos.length === 0) {
            return res.status(404).render('404', { message: 'Видео не найдено' });
        }
        
        const video = videos[0];
        
        // ====== ЗАЩИТА ОТ НАКРУТКИ ПРОСМОТРОВ ======
        // Используем куки для отслеживания просмотренных видео
        const viewedVideos = req.cookies.viewed_videos ? 
            JSON.parse(req.cookies.viewed_videos) : [];
        
        if (!viewedVideos.includes(parseInt(videoId))) {
            // Увеличиваем просмотры только если не смотрел
            await pool.execute('UPDATE videos SET views = views + 1 WHERE id = ?', [videoId]);
            video.views++;
            
            // Добавляем в список просмотренных
            viewedVideos.push(parseInt(videoId));
            
            // Храним только последние 100 видео
            if (viewedVideos.length > 100) {
                viewedVideos.shift();
            }
            
            // Устанавливаем куку на 24 часа
            res.cookie('viewed_videos', JSON.stringify(viewedVideos), {
                maxAge: 24 * 60 * 60 * 1000,
                httpOnly: true
            });
        }
        
        // Получаем комментарии
        const [comments] = await pool.execute(`
            SELECT c.*, u.username, u.avatar
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.video_id = ?
            ORDER BY c.created_at DESC
        `, [videoId]);
        
        // Проверяем реакцию пользователя
        let userReaction = null;
        if (req.user) {
            const [reactions] = await pool.execute(
                'SELECT reaction FROM video_reactions WHERE video_id = ? AND user_id = ?',
                [videoId, req.user.id]
            );
            if (reactions.length > 0) {
                userReaction = reactions[0].reaction;
            }
        }
        
        // Рекомендованные видео
        const [recommended] = await pool.execute(`
            SELECT v.*, u.username, u.avatar
            FROM videos v
            JOIN users u ON v.user_id = u.id
            WHERE v.id != ?
            ORDER BY RAND()
            LIMIT 8
        `, [videoId]);
        
        res.render('watch', {
            video,
            comments,
            userReaction,
            recommended
        });
        
    } catch (error) {
        console.error('Ошибка просмотра:', error);
        res.status(500).send('Ошибка сервера');
    }
});

// POST /watch/:id/react — лайк/дизлайк (без перезагрузки + реалтайм)
router.post('/watch/:id/react', requireAuth, async (req, res) => {
    try {
        const videoId = req.params.id;
        const { reaction } = req.body;
        const io = req.app.get('io');
        
        // Проверяем существующую реакцию
        const [existing] = await pool.execute(
            'SELECT reaction FROM video_reactions WHERE video_id = ? AND user_id = ?',
            [videoId, req.user.id]
        );
        
        let newReaction = null;
        
        if (existing.length > 0) {
            const oldReaction = existing[0].reaction;
            
            if (oldReaction === reaction) {
                // Убираем реакцию
                await pool.execute(
                    'DELETE FROM video_reactions WHERE video_id = ? AND user_id = ?',
                    [videoId, req.user.id]
                );
                await pool.execute(
                    `UPDATE videos SET ${reaction}s = ${reaction}s - 1 WHERE id = ?`,
                    [videoId]
                );
                newReaction = null;
            } else {
                // Меняем реакцию
                await pool.execute(
                    'UPDATE video_reactions SET reaction = ? WHERE video_id = ? AND user_id = ?',
                    [reaction, videoId, req.user.id]
                );
                await pool.execute(
                    `UPDATE videos SET ${oldReaction}s = ${oldReaction}s - 1, ${reaction}s = ${reaction}s + 1 WHERE id = ?`,
                    [videoId]
                );
                newReaction = reaction;
            }
        } else {
            // Новая реакция
            await pool.execute(
                'INSERT INTO video_reactions (video_id, user_id, reaction) VALUES (?, ?, ?)',
                [videoId, req.user.id, reaction]
            );
            await pool.execute(
                `UPDATE videos SET ${reaction}s = ${reaction}s + 1 WHERE id = ?`,
                [videoId]
            );
            newReaction = reaction;
        }
        
        // Получаем обновлённые счётчики
        const [updated] = await pool.execute(
            'SELECT likes, dislikes FROM videos WHERE id = ?',
            [videoId]
        );
        
        const counts = {
            likes: updated[0].likes,
            dislikes: updated[0].dislikes
        };
        
        // Отправляем всем в комнате через Socket.io
        io.to(`video-${videoId}`).emit('reaction-update', counts);
        
        res.json({ 
            reaction: newReaction,
            counts
        });
        
    } catch (error) {
        console.error('Ошибка реакции:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// POST /watch/:id/comment — добавить комментарий (реалтайм)
router.post('/watch/:id/comment', requireAuth, async (req, res) => {
    try {
        const videoId = req.params.id;
        const { text } = req.body;
        const io = req.app.get('io');
        
        if (!text || text.trim() === '') {
            return res.status(400).json({ error: 'Комментарий не может быть пустым' });
        }
        
        const [result] = await pool.execute(
            'INSERT INTO comments (video_id, user_id, text) VALUES (?, ?, ?)',
            [videoId, req.user.id, text.trim()]
        );
        
        const comment = {
            id: result.insertId,
            text: text.trim(),
            username: req.user.username,
            avatar: req.user.avatar,
            created_at: new Date().toISOString()
        };
        
        // Отправляем всем в комнате через Socket.io
        io.to(`video-${videoId}`).emit('new-comment', comment);
        
        // Обновляем счётчик комментариев
        const [countResult] = await pool.execute(
            'SELECT COUNT(*) as count FROM comments WHERE video_id = ?',
            [videoId]
        );
        io.to(`video-${videoId}`).emit('comments-count', countResult[0].count);
        
        res.json(comment);
        
    } catch (error) {
        console.error('Ошибка комментария:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// DELETE /video/:id — удаление видео
router.delete('/video/:id', requireAuth, async (req, res) => {
    try {
        const videoId = req.params.id;
        
        const [videos] = await pool.execute(
            'SELECT user_id FROM videos WHERE id = ?',
            [videoId]
        );
        
        if (videos.length === 0 || videos[0].user_id !== req.user.id) {
            return res.status(403).json({ error: 'Нет прав' });
        }
        
        await pool.execute('DELETE FROM videos WHERE id = ?', [videoId]);
        res.json({ success: true });
        
    } catch (error) {
        console.error('Ошибка удаления:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

module.exports = router;