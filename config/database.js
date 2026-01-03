/**
 * config/database.js
 * Прямое подключение для устранения ошибки ECONNREFUSED
 */

const mysql = require('mysql2/promise');

// Мы используем данные напрямую, чтобы исключить ошибку переменных
const dbConfig = {
    host: 'bbrmoi0qdtjqbvctknfg-mysql.services.clever-cloud.com', 
    user: 'uqexiir2rgm3cunz', 
    password: 'CW8asr6RhWONjpfvGPVH', 
    database: 'bbrmoi0qdtjqbvctknfg', 
    port: 3306,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    // ВАЖНО: SSL обязателен для связи Render -> Clever Cloud
    ssl: {
        rejectUnauthorized: false
    }
};

const pool = mysql.createPool(dbConfig);

async function initDatabase() {
    try {
        console.log(`🔌 [DEBUG] Попытка подключения к: ${dbConfig.host}`);
        
        // Тестовое соединение
        const connection = await pool.getConnection();
        console.log('✅ [DEBUG] УСПЕХ! База данных подключена.');
        connection.release();

        // --- СОЗДАНИЕ ТАБЛИЦ ---
        
        await pool.execute(`CREATE TABLE IF NOT EXISTS users (
            id INT PRIMARY KEY AUTO_INCREMENT,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            avatar VARCHAR(255) DEFAULT 'default.png',
            subscribers_count INT DEFAULT 0,
            is_admin BOOLEAN DEFAULT FALSE,
            is_banned BOOLEAN DEFAULT FALSE,
            ban_reason VARCHAR(255) DEFAULT NULL,
            last_ip VARCHAR(45) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.execute(`CREATE TABLE IF NOT EXISTS videos (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            title VARCHAR(200) NOT NULL,
            description TEXT,
            filename VARCHAR(255) NOT NULL,
            thumbnail VARCHAR(255) DEFAULT 'default_thumb.png',
            views INT DEFAULT 0,
            likes INT DEFAULT 0,
            dislikes INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await pool.execute(`CREATE TABLE IF NOT EXISTS comments (
            id INT PRIMARY KEY AUTO_INCREMENT,
            video_id INT NOT NULL,
            user_id INT NOT NULL,
            text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await pool.execute(`CREATE TABLE IF NOT EXISTS subscriptions (
            id INT PRIMARY KEY AUTO_INCREMENT,
            subscriber_id INT NOT NULL,
            channel_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_sub (subscriber_id, channel_id),
            FOREIGN KEY (subscriber_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (channel_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await pool.execute(`CREATE TABLE IF NOT EXISTS video_reactions (
            id INT PRIMARY KEY AUTO_INCREMENT,
            video_id INT NOT NULL,
            user_id INT NOT NULL,
            reaction ENUM('like', 'dislike') NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_reaction (video_id, user_id),
            FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

         await pool.execute(`CREATE TABLE IF NOT EXISTS ip_bans (
            id INT PRIMARY KEY AUTO_INCREMENT,
            ip_address VARCHAR(45) NOT NULL UNIQUE,
            reason VARCHAR(255) DEFAULT 'Нарушение правил',
            banned_by INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await pool.execute(`CREATE TABLE IF NOT EXISTS user_ips (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            ip_address VARCHAR(45) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_user_ip (user_id, ip_address),
            INDEX idx_ip (ip_address)
        )`);

        await pool.execute(`CREATE TABLE IF NOT EXISTS admin_logs (
            id INT PRIMARY KEY AUTO_INCREMENT,
            admin_id INT NOT NULL,
            action VARCHAR(100) NOT NULL,
            target_type VARCHAR(50) NOT NULL,
            target_id INT,
            details TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        
        console.log('✅ Таблицы готовы');

    } catch (error) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА ПОДКЛЮЧЕНИЯ:', error.message);
        console.error('Проверьте, не заблокирован ли доступ к Clever Cloud для IP адресов Render.');
    }
}

module.exports = { pool, initDatabase };