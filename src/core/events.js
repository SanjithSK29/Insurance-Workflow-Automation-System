// In-process event bus standing in for Kafka. Topics and payloads match what
// the services would publish to Kafka, so swapping in a real broker only
// touches this file.
const { EventEmitter } = require('node:events');

function createEventBus(logger) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);
  const history = [];

  return {
    publish(topic, payload) {
      history.push({ topic, payload, at: new Date().toISOString() });
      if (history.length > 1000) history.shift();
      for (const handler of emitter.listeners(topic)) {
        try {
          handler(payload);
        } catch (err) {
          // A failing consumer must not break the producer (loose coupling).
          logger.error('event_handler_failed', { topic, error: err.message });
        }
      }
    },
    subscribe(topic, handler) {
      emitter.on(topic, handler);
    },
    history: () => history.slice(),
  };
}

module.exports = { createEventBus };
