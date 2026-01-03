/**
 * Роуты аутентификации: регистрация, вход, выход
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const router = express.Router();

// GET /register — страница регистрации
router.get('/register', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('register', { error: null });
});

// POST /register — обработка регистрации
router.post('/register', async (req, res) => {
    try {
        const { username, email, password, confirmPassword } = req.body;
        
        // Валидация
        if (!username || !email || !password) {
            return res.render('register', { error: 'Заполните все поля' });
        }
        
        if (password !== confirmPassword) {
            return res.render('register', { error: 'Пароли не совпадают' });
        }
        
        if (password.length < 6) {
            return res.render('register', { error: 'Пароль минимум 6 символов' });
        }
        
        // Проверяем существует ли пользователь
        const [existing] = await pool.execute(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );
        
        if (existing.length > 0) {
            return res.render('register', { error: 'Username или Email уже занят' });
        }
        
        // Хэшируем пароль
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Создаём пользователя
        const [result] = await pool.execute(
            'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
            [username, email, hashedPassword]
        );
        
        // Создаём JWT токен
        const token = jwt.sign(
            { userId: result.insertId },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );
        
        // Устанавливаем куку
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 дней
        });
        
        res.redirect('/');
        
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.render('register', { error: 'Ошибка сервера' });
    }
});

// GET /login — страница входа
router.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.render('login', { error: null });
});

// POST /login — обработка входа
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Ищем пользователя
        const [users] = await pool.execute(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
        
        if (users.length === 0) {
            return res.render('login', { error: 'Неверный email или пароль' });
        }
        
        const user = users[0];
        
        // Проверяем пароль
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
            return res.render('login', { error: 'Неверный email или пароль' });
        }
        
        // Создаём JWT токен
        const token = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );
        
        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        
        res.redirect('/');
        
    } catch (error) {
        console.error('Ошибка входа:', error);
        res.render('login', { error: 'Ошибка сервера' });
    }
});

// GET /logout — выход
router.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/');
});

module.exports = router;