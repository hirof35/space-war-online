const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- ゲーム状態 ---
let players = {};
let bullets = [];
let enemies = [];
let enemyBullets = [];
let items = [];
let boss = { active: false, x: 400, y: -200, hp: 1000, maxHp: 1000, mode: 'enter', timer: 0 };
let gameState = 'TITLE'; 

// --- ゲーム設定 ---
const CANVAS_W = 800;
const CANVAS_H = 600;

io.on('connection', (socket) => {
    players[socket.id] = { x: 400, y: 500,vx: 0, vy: 0, hp: 3, score: 0, weapon: 'normal', barrier: false };
    
    socket.on('startGame', () => {
        if (gameState !== 'PLAYING') {
            gameState = 'PLAYING';
            resetGame();
            io.emit('changeScene', 'PLAYING');
        }
    });

    socket.on('move', (data) => {
        const p = players[socket.id];
        if (p) {
            // 直接座標を変えるのではなく、加速させる（感度の調整）
            p.vx += data.x * 0.5; 
            p.vy += data.y * 0.5;
        }
    });

    socket.on('shoot', () => {
        const p = players[socket.id];
        if (p && gameState === 'PLAYING') {
            if (p.weapon === '3way') {
                [-0.2, 0, 0.2].forEach(a => bullets.push({ x: p.x, y: p.y, vx: Math.sin(a) * 10, vy: -Math.cos(a) * 10, owner: socket.id }));
            } else {
                bullets.push({ x: p.x, y: p.y, vx: 0, vy: -10, owner: socket.id });
            }
        }
    });

    socket.on('disconnect', () => delete players[socket.id]);
});

function resetGame() {
    enemies = []; bullets = []; enemyBullets = []; items = [];
    boss = { active: false, x: 400, y: -200, hp: 1000, maxHp: 1000, mode: 'enter', timer: 0 };
    Object.values(players).forEach(p => { p.hp = 3; p.score = 0; p.weapon = 'normal'; p.barrier = false; });
}

// --- メインループ (60FPS) ---
setInterval(() => {
    if (gameState !== 'PLAYING') return;

    // 1. 弾の移動
    bullets.forEach((b, i) => { b.x += b.vx; b.y += b.vy; if (b.y < 0) bullets.splice(i, 1); });
    enemyBullets.forEach((b, i) => { b.x += b.vx; b.y += b.vy; if (b.y > CANVAS_H) enemyBullets.splice(i, 1); });

    // 2. 敵の生成と移動
    if (Math.random() < 0.02 && !boss.active) {
        enemies.push({ id: Date.now(), x: Math.random() * CANVAS_W, y: -50, hp: 2, originX: Math.random() * CANVAS_W });
    }
    enemies.forEach((e, i) => {
        e.y += 2;
        e.x = e.originX + Math.sin(e.y / 50) * 50; // サインカーブ移動
        if (e.y > CANVAS_H) enemies.splice(i, 1);
    });

    // 3. ボス出現フラグ (スコア合計が3000を超えたら)
    const totalScore = Object.values(players).reduce((s, p) => s + p.score, 0);
    if (totalScore >= 3000 && !boss.active) boss.active = true;

    if (boss.active) updateBossLogic();
    // --- server.js の更新ループ内 ---

    // 4. プレイヤー当たり判定
    // プレイヤーごとのループ
    Object.keys(players).forEach(id => {
        const p = players[id];
        
        // 自機 vs 敵の直接衝突
        enemies.forEach((e, ei) => {
            if (Math.hypot(p.x - e.x, p.y - e.y) < 35) {
                enemies.splice(ei, 1);
                io.emit('explosion', { x: e.x, y: e.y });
                if (!p.barrier) p.hp--;
                else p.barrier = false;
            }
        });

        // 自機 vs 敵の弾
        enemyBullets.forEach((eb, ebi) => {
            if (Math.hypot(p.x - eb.x, p.y - eb.y) < 15) {
                enemyBullets.splice(ebi, 1);
                if (!p.barrier) p.hp--;
                else p.barrier = false;
            }
        });

        // HPゼロでゲームオーバー判定
        if (p.hp <= 0 && gameState === 'PLAYING') {
            gameState = 'GAMEOVER';
            io.emit('changeScene', 'GAMEOVER');
        }
    });
    // 弾と敵・ボスの判定を1つのループにまとめる
    bullets.forEach((b, bi) => {
        let hit = false;

        // ザコ敵との判定
        enemies.forEach((e, ei) => {
            if (hit) return;
            // 判定距離を少し広め(35)に設定
            if (Math.hypot(e.x - b.x, e.y - b.y) < 35) {
                e.hp--;
                hit = true;
                if (e.hp <= 0) {
                    // アイテムドロップ
                    if (Math.random() < 0.3) items.push({ x: e.x, y: e.y, type: Math.random() > 0.5 ? 'W' : 'S' });
                    if (players[b.owner]) players[b.owner].score += 100;
                    enemies.splice(ei, 1);
                    io.emit('explosion', { x: e.x, y: e.y });
                }
            }
        });

        // ボスとの判定（ボスがアクティブな時のみ）
        if (!hit && boss.active) {
            if (b.x > boss.x - 110 && b.x < boss.x + 110 &&
                b.y > boss.y - 80 && b.y < boss.y + 80) {
                boss.hp -= 10;
                hit = true;
                if (players[b.owner]) players[b.owner].score += 10;
                if (boss.hp <= 0) {
                    gameState = 'GAMEOVER';
                    io.emit('changeScene', 'GAMEOVER');
                }
            }
        }

        // 何かに当たっていたら弾を消す
        if (hit) {
            bullets.splice(bi, 1);
        }
    });

    // 6. アイテム取得
    items.forEach((it, i) => {
        it.y += 3;
        Object.keys(players).forEach(id => {
            if (Math.hypot(players[id].x - it.x, players[id].y - it.y) < 30) {
                if (it.type === 'W') players[id].weapon = '3way';
                else players[id].barrier = true;
                items.splice(i, 1);
            }
        });
    });
    // ゲームループ(setInterval)内に追加する物理計算
    Object.values(players).forEach(p => {
        p.x += p.vx;
        p.y += p.vy;

        // 摩擦（だんだん減速させる）
        p.vx *= 0.9;
        p.vy *= 0.9;

        // 画面外に出ないように制限
        p.x = Math.max(15, Math.min(CANVAS_W - 15, p.x));
        p.y = Math.max(15, Math.min(CANVAS_H - 15, p.y));
    });
    io.emit('state', { players, bullets, enemies, enemyBullets, items, boss });
}, 1000 / 60);

function updateBossLogic() {
    boss.timer++;
    if (boss.mode === 'enter') {
        if (boss.y < 120) boss.y += 1; else boss.mode = 'attack';
    } else {
        boss.x = 400 + Math.sin(boss.timer / 50) * 200;
        if (boss.timer % 40 === 0) {
            const target = Object.values(players)[0];
            if (target) {
                const angle = Math.atan2(target.y - boss.y, target.x - boss.x);
                enemyBullets.push({ x: boss.x, y: boss.y, vx: Math.cos(angle) * 5, vy: Math.sin(angle) * 5 });
            }
        }
    }
}

server.listen(3000, () => console.log('Server running on http://localhost:3000'));
