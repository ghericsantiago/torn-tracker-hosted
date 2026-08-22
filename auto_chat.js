// ==UserScript==
// @name         Torn Trade Chat Sender
// @namespace    https://torn.com/
// @version      1.2
// @description  Sends trade message every 70 seconds only when Trade chat is open
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    const SEND_INTERVAL = 70; // seconds
    const SEND_DELAY = 1000;  // wait before clicking send

    const LOCK_KEY = 'tradeSenderActiveTab';
    const ENABLE_KEY = 'tradeSenderEnabled';

    const TAB_ID =
        Date.now().toString(36) +
        Math.random().toString(36).substring(2);

    let senderInterval = null;
    let countdownInterval = null;
    let remaining = SEND_INTERVAL;

    const value = [
        `💰 BUYING ITEMS 💰`,
        `🌸 Flowers 💯% MV`,
        `🧸 Plushies 💯% MV`,
        `🍫 Candy ⚡ Energy + More`,
        `➡️<a href="https://itrade.devs.surf/trade/">Prices</a>`,
        `➡️<a href="//www.torn.com/trade.php#step=start&userID=3308452">Trade</a>`,
        `🟢 <a href="//www.torn.com/bazaar.php?userId=3308452">Bazaar Open</a>`
    ].join('<br>');

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // =========================================================
    // UI
    // =========================================================

    const toggleButton = document.createElement('button');

    Object.assign(toggleButton.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: '999999',
        padding: '10px 15px',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        fontWeight: 'bold',
        color: '#fff',
        minWidth: '120px'
    });

    document.body.appendChild(toggleButton);

    function updateButton() {
        const enabled = GM_getValue(ENABLE_KEY, false);
        const owner = localStorage.getItem(LOCK_KEY);

        if (enabled && owner === TAB_ID) {
            toggleButton.textContent = `🟢 ON (${remaining}s)`;
            toggleButton.style.background = '#2ecc71';
        } else {
            toggleButton.textContent = '🔴 OFF';
            toggleButton.style.background = '#e74c3c';
        }
    }

    // =========================================================
    // CHECK IF TRADE CHAT IS OPEN
    // =========================================================

    function getTradeChat() {
        return document.querySelector('#chatRoot div#public_trade');
    }

    function isTradeOpen() {
        const tradeChat = getTradeChat();

        if (!tradeChat) {
            return false;
        }

        const textarea = tradeChat.querySelector('textarea');

        return !!textarea;
    }

    // =========================================================
    // SEND MESSAGE
    // =========================================================

    async function sendMessage() {

        if (!isTradeOpen()) {
            console.log('⏸️ Trade chat is not open. Message skipped.');
            return;
        }

        const tradeChat = getTradeChat();

        if (!tradeChat) {
            console.log('⏸️ Trade chat not found.');
            return;
        }

        // Only get textarea INSIDE Trade
        const textarea = tradeChat.querySelector('textarea');

        if (!textarea) {
            console.log('⏸️ Trade textarea not found.');
            return;
        }

        console.log('✅ Trade chat detected');

        const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value'
        ).set;

        setter.call(textarea, value);

        textarea.dispatchEvent(
            new Event('input', {
                bubbles: true
            })
        );

        textarea.dispatchEvent(
            new Event('change', {
                bubbles: true
            })
        );

        console.log('📝 Trade message inserted');

        // Wait for Torn / React to update
        await sleep(SEND_DELAY);

        // =====================================================
        // CHECK AGAIN BEFORE SENDING
        // =====================================================

        const currentTradeChat = getTradeChat();

        if (!currentTradeChat) {
            console.log(
                '⚠️ Trade chat closed while preparing message. Cancelled.'
            );
            return;
        }

        if (!currentTradeChat.contains(textarea)) {
            console.log(
                '⚠️ Trade textarea changed. Send cancelled.'
            );
            return;
        }

        if (!textarea.value || !textarea.value.trim()) {
            console.log('❌ Trade textarea became empty.');
            return;
        }

        // =====================================================
        // FIND THE SEND BUTTON
        // =====================================================

        const inputContainer = textarea.parentElement;

        if (!inputContainer) {
            console.log('❌ Input container not found.');
            return;
        }

        const sendButton = inputContainer.querySelector('button');

        if (!sendButton) {
            console.log('❌ Trade send button not found.');
            return;
        }

        // Torn may temporarily disable it
        if (sendButton.disabled) {
            console.log('⏳ Trade send button is disabled. Waiting...');

            await sleep(1000);
        }

        // Check one last time
        if (!isTradeOpen()) {
            console.log(
                '⚠️ Trade chat is no longer open. Send cancelled.'
            );
            return;
        }

        if (sendButton.disabled) {
            console.log(
                '❌ Send button is still disabled. Message skipped.'
            );
            return;
        }

        console.log('📨 Clicking Trade Send...');

        sendButton.click();

        console.log(
            `✅ Trade message sent at ${new Date().toLocaleTimeString()}`
        );
    }

    // =========================================================
    // START
    // =========================================================

    function start() {

        const currentOwner = localStorage.getItem(LOCK_KEY);

        // Prevent multiple tabs from sending
        if (currentOwner && currentOwner !== TAB_ID) {
            console.log(
                '⚠️ Trade sender is already running in another tab.'
            );

            updateButton();
            return;
        }

        localStorage.setItem(LOCK_KEY, TAB_ID);
        GM_setValue(ENABLE_KEY, true);

        clearInterval(senderInterval);
        clearInterval(countdownInterval);

        remaining = SEND_INTERVAL;

        console.log(
            `🟢 Trade sender enabled. First attempt in ${SEND_INTERVAL}s`
        );

        // =====================================================
        // COUNTDOWN
        // =====================================================

        countdownInterval = setInterval(() => {

            if (localStorage.getItem(LOCK_KEY) !== TAB_ID) {
                stop(false);
                return;
            }

            remaining--;

            if (isTradeOpen()) {
                console.log(
                    `⏳ Trade open — next send in ${remaining}s`
                );
            } else {
                console.log(
                    `⏳ Trade closed — next check in ${remaining}s`
                );
            }

            if (remaining <= 0) {
                remaining = SEND_INTERVAL;
            }

            updateButton();

        }, 1000);

        // =====================================================
        // SEND INTERVAL
        // =====================================================

        senderInterval = setInterval(async () => {

            if (localStorage.getItem(LOCK_KEY) !== TAB_ID) {
                stop(false);
                return;
            }

            remaining = SEND_INTERVAL;
            updateButton();

            if (!isTradeOpen()) {
                console.log(
                    '⏸️ 70 seconds reached, but Trade is closed. Skipping.'
                );

                return;
            }

            await sendMessage();

        }, SEND_INTERVAL * 1000);

        updateButton();
    }

    // =========================================================
    // STOP
    // =========================================================

    function stop(removeLock = true) {

        clearInterval(senderInterval);
        clearInterval(countdownInterval);

        senderInterval = null;
        countdownInterval = null;

        if (
            removeLock &&
            localStorage.getItem(LOCK_KEY) === TAB_ID
        ) {
            localStorage.removeItem(LOCK_KEY);
        }

        GM_setValue(ENABLE_KEY, false);

        remaining = SEND_INTERVAL;

        console.log('🔴 Trade sender disabled');

        updateButton();
    }

    // =========================================================
    // TOGGLE BUTTON
    // =========================================================

    toggleButton.addEventListener('click', () => {

        const enabled = GM_getValue(ENABLE_KEY, false);
        const owner = localStorage.getItem(LOCK_KEY);

        if (
            enabled &&
            owner === TAB_ID
        ) {
            stop();
        } else {
            start();
        }
    });

    // =========================================================
    // RELEASE LOCK WHEN TAB CLOSES
    // =========================================================

    window.addEventListener('beforeunload', () => {

        if (localStorage.getItem(LOCK_KEY) === TAB_ID) {
            localStorage.removeItem(LOCK_KEY);
            GM_setValue(ENABLE_KEY, false);
        }
    });

    // =========================================================
    // INITIALIZE
    // =========================================================

    updateButton();

})();