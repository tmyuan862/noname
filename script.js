// 点击按钮后将 h1 和 p 的文本改为 "神临" 并应用大号金黄色样式
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('changeBtn');
    const title = document.querySelector('h1');
    const para = document.querySelector('p');

    btn.addEventListener('click', () => {
        if (title) {
            title.textContent = '神临';
            title.classList.add('shenlin-target');
        }
        if (para) {
            para.textContent = '神临';
            para.classList.add('shenlin-target');
        }
    });
});