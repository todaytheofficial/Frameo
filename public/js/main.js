/**
 * Frameo — Клиентский JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
    // Подписка на канал
    const subscribeBtn = document.getElementById('subscribeBtn');
    if (subscribeBtn) {
        subscribeBtn.addEventListener('click', async () => {
            const channelId = subscribeBtn.dataset.channel;
            
            try {
                const res = await fetch(`/channel/subscribe/${channelId}`, {
                    method: 'POST'
                });
                
                if (res.ok) {
                    const data = await res.json();
                    subscribeBtn.textContent = data.subscribed ? 'Отписаться' : 'Подписаться';
                    subscribeBtn.classList.toggle('btn-primary', !data.subscribed);
                    subscribeBtn.classList.toggle('btn-secondary', data.subscribed);
                    
                    // Обновляем счётчик
                    const subsCount = document.querySelector('.channel-stats');
                    if (subsCount) {
                        const currentCount = parseInt(subsCount.textContent.match(/\d+/)[0]);
                        const newCount = data.subscribed ? currentCount + 1 : currentCount - 1;
                        subsCount.textContent = subsCount.textContent.replace(/\d+/, newCount);
                    }
                }
            } catch (error) {
                console.error('Ошибка:', error);
            }
        });
    }
    
    // Превью видео при наведении
    document.querySelectorAll('.video-thumbnail video, .sidebar-thumbnail').forEach(video => {
        let playPromise = null;
        
        video.addEventListener('mouseenter', () => {
            playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {});
            }
        });
        
        video.addEventListener('mouseleave', () => {
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    video.pause();
                    video.currentTime = 0;
                }).catch(() => {});
            }
        });
    });
});