/**
 * Frameo — Главный сервер
 * Минималистичная видеоплатформа с реалтаймом
 */

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const { pool, initDatabase } = require('./config/database');
const { authMiddleware } = require('./middleware/auth');

// Роуты
const authRoutes = require('./routes/auth');
const channelRoutes = require('./routes/channel');
const videoRoutes = require('./routes/video');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);

// Socket.io для реалтайма
const io = new Server(server);

// Делаем io доступным в роутах
app.set('io', io);
// Trust proxy для корректного определения IP
app.set('trust proxy', true);

const PORT = process.env.PORT || 3000;

// ====== MIDDLEWARE ======
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Авторизация на всех страницах
app.use(authMiddleware);

// ====== SOCKET.IO ======
io.on('connection', (socket) => {
    console.log('👤 Пользователь подключился:', socket.id);
    
    socket.on('join-video', (videoId) => {
        socket.join(`video-${videoId}`);
    });
    
    socket.on('leave-video', (videoId) => {
        socket.leave(`video-${videoId}`);
    });
    
    socket.on('disconnect', () => {
        console.log('👤 Пользователь отключился:', socket.id);
    });
});

// ====== РОУТЫ ======
app.use('/', authRoutes);
app.use('/', channelRoutes);
app.use('/', videoRoutes);
app.use('/', adminRoutes);

// Главная страница
app.get('/', async (req, res) => {
    try {
        const [videos] = await pool.execute(`
            SELECT v.*, u.username, u.avatar,
                   (SELECT COUNT(*) FROM comments WHERE video_id = v.id) as comments_count
            FROM videos v
            JOIN users u ON v.user_id = u.id
            WHERE u.is_banned = FALSE
            ORDER BY v.created_at DESC
            LIMIT 20
        `);
        
        res.render('index', { videos });
    } catch (error) {
        console.error('Ошибка главной:', error);
        res.status(500).send('Ошибка сервера');
    }
});

// 403 — Доступ запрещён
app.get('/403', (req, res) => {
    res.status(403).render('403', { message: 'Доступ запрещён' });
});

// 404
app.use((req, res) => {
    res.status(404).render('404', { message: 'Страница не найдена' });
});

// ====== ЗАПУСК ======
async function startServer() {
    await initDatabase();
    
    server.listen(PORT, () => {
        console.log(`
╔═══════════════════════════════════════╗
║                                       ║
║   🎬 FRAMEO запущен!                  ║
║   http://localhost:${PORT}              ║
║                                       ║
╚═══════════════════════════════════════╝
        `);
    });
}

startServer();