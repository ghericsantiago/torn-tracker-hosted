const delay = 60; // seconds
let remaining = delay;

console.log(`Sending in ${remaining}s...`);

const countdown = setInterval(() => {
    remaining--;

    console.log(`Sending in ${remaining}s...`);

    if (remaining <= 0) {
        clearInterval(countdown);
    }
}, 1000);

const timeout = setTimeout(() => {
    const value = `💰 BUYING ITEMS 💰<br>🌸 Flowers 💯% MV<br>🧸 Plushies 💯% MV<br>🍫 Candy ⚡ Energy + More<br>➡️<a href="https://itrade.devs.surf/trade/">Prices</a><br>➡️<a href="//www.torn.com/trade.php#step=start&userID=3308452">Trade</a><br>🟢 <a href="//www.torn.com/bazaar.php?userId=3308452">Bazaar Open</a>`;

    const textarea = document.querySelector('#chatRoot textarea');

    const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
    ).set;

    setter.call(textarea, value);

    textarea.dispatchEvent(new Event("input", {
        bubbles: true
    }));

    textarea.dispatchEvent(new Event("change", {
        bubbles: true
    }));

    document.querySelectorAll('#chatRoot button')[1].click();

    console.log("Message sent!");
}, delay * 1000);