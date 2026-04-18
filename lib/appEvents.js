/**
 * Lightweight internal bus for decoupling DB mutations from Socket.io / side effects.
 */

const { EventEmitter } = require('events');

const appEvents = new EventEmitter();
appEvents.setMaxListeners(50);

module.exports = appEvents;
