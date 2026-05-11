const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const socket = io();

let gameState = { players: {}, bullets: [], enemies: [], enemyBullets: [], items: [], boss: {} };
let currentScene = 'TITLE';
let particles = [];

socket.on('state', (state) => gameState = state);
socket.on('changeScene', (s) => currentScene = s);
socket.on('explosion', (pos) => {
    for (let i = 0; i < 10; i++) particles.push({ x: pos.x, y: pos.y, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, life: 1 });
});

function draw() {
    updateInput(); // ここに追加
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, 800, 600);
    
    if (currentScene === 'TITLE') {
        drawText("SPACE WARRIORS", 400, 250, 50, "white");
        drawText("Press SPACE to Start", 400, 350, 20, "gray");
    } else {
        // --- プレイヤーUI (PLAYING/GAMEOVER共通) ---
        const myP = gameState.players[socket.id];
        if (myP) {
            ctx.fillStyle = "white";
            ctx.font = "bold 24px 'Courier New'";
            ctx.textAlign = "left";
            ctx.fillText(`SCORE: ${myP.score.toLocaleString()}`, 20, 40);
            
            ctx.fillStyle = "red";
            ctx.fillText("LIFE: ", 20, 70);
            for (let i = 0; i < myP.hp; i++) {
                ctx.fillRect(90 + (i * 25), 52, 15, 20);
            }
        }
        Object.keys(gameState.players).forEach(id => {
            const p = gameState.players[id];
            ctx.fillStyle = p.weapon === '3way' ? '#ff00ff' : '#00ffff';
            ctx.fillRect(p.x - 15, p.y - 15, 30, 30);
            if (p.barrier) {
                ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 35, 0, Math.PI*2); ctx.stroke();
            }
        });
        // 敵・弾・アイテム・ボス描画
        // public/game.js の draw() 内
        ctx.fillStyle = 'white';
        // 弾を少し太く (4px -> 6px)
        gameState.bullets.forEach(b => ctx.fillRect(b.x - 3, b.y - 5, 6, 12));
        ctx.fillStyle = 'red';
        gameState.enemies.forEach(e => ctx.beginPath() || ctx.arc(e.x, e.y, 20, 0, Math.PI*2) || ctx.fill());
        ctx.fillStyle = 'yellow';
        gameState.enemyBullets.forEach(b => ctx.beginPath() || ctx.arc(b.x, b.y, 5, 0, Math.PI*2) || ctx.fill());
        gameState.items.forEach(it => drawText(it.type, it.x, it.y, 20, "lime"));

        if (gameState.boss.active) {
            ctx.fillStyle = 'darkred'; ctx.fillRect(gameState.boss.x - 100, gameState.boss.y - 75, 200, 150);
            ctx.fillStyle = 'red'; ctx.fillRect(100, 20, 600 * (gameState.boss.hp / gameState.boss.maxHp), 10);
        }

        // パーティクル
        particles.forEach((p, i) => {
            p.x += p.vx; p.y += p.vy; p.life -= 0.02;
            ctx.fillStyle = `rgba(255, 100, 0, ${p.life})`;
            ctx.fillRect(p.x, p.y, 3, 3);
            if (p.life <= 0) particles.splice(i, 1);
        });
        

        if (currentScene === 'GAMEOVER') {
            ctx.fillStyle = "rgba(0,0,0,0.5)"; // 背景を少し暗く
            ctx.fillRect(0,0,800,600);
            drawText("GAME OVER", 400, 280, 50, "red");
            drawText("Press R to Restart", 400, 350, 20, "white");
        }
    }
    requestAnimationFrame(draw);
}

function drawText(t, x, y, s, c) { ctx.fillStyle = c; ctx.font = `${s}px Arial`; ctx.textAlign = "center"; ctx.fillText(t, x, y); }

// キーの状態を管理するオブジェクト
const keys = {};

window.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    if (e.key === ' ') socket.emit(currentScene === 'TITLE' ? 'startGame' : 'shoot');
    if (e.key === 'r' && currentScene === 'GAMEOVER') socket.emit('startGame');
});

window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

// 毎フレーム入力をチェックしてサーバーに送る
function updateInput() {
    if (currentScene !== 'PLAYING') return;

    let dx = 0;
    let dy = 0;
    if (keys['ArrowLeft']) dx -= 1;
    if (keys['ArrowRight']) dx += 1;
    if (keys['ArrowUp']) dy -= 1;
    if (keys['ArrowDown']) dy += 1;

    // 入力がある場合だけサーバーに「加速量」を送る
    if (dx !== 0 || dy !== 0) {
        socket.emit('move', { x: dx, y: dy });
    }
}

draw();
