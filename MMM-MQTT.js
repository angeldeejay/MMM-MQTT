/* Magic Mirror
 * Module: MMM-MQTT
 *
 * By jupadin
 * MIT Licensed.
 */

Module.register("MMM-MQTT", {
  // Default module config.
  defaults: {
    header: "MMM-MQTT",
    animationSpeed: 2 * 1000, // 2 seconds
    port: 1883,
  },

  // Define start sequence.
  start: function () {
    Log.info("Starting module: " + this.name);
    const self = this;
    this.fetchedData = [];
    this.config = { ...this.defaults, ...this.config };

    this.config.mqttBrokers.forEach((mqttBroker) => {
      const broker = {
        url: (mqttBroker.url.match(/^mqtts?:\/\//) ? "" : "mqtt://") + mqttBroker.url,
        port: mqttBroker.port || self.config.port,
        auth: mqttBroker.auth,
        topics: [],
      };

      broker.topics.push(
        ...mqttBroker.subscriptions
          .map((sub) => sub.topic)
          .filter((topic) => !broker.topics.includes(topic))
      );

      // Create initialized objects for each topic of each subscription the broker.
      mqttBroker.subscriptions.forEach((subscription) => {
        let fetchedData = {
          broker: broker.url,
          topic: subscription.topic,
          label: subscription.label || "",
          suffix: subscription.suffix || "",
          value: null,
          time: Date.now(),
          colors: subscription.colors || false,
          showLabelAsIcon: subscription.showLabelAsIcon || false,
          icon: subscription.icon || "",
          conversion: subscription.conversion || false,
          position: subscription.position || 1,
          offset: subscription.offset || false,
          factor: subscription.factor || false,
          decimals: 1 || subscription.decimals,
          average: false,
          pastValues: [],
          animationSpeed: this.config.animationSpeed,
        };
        fetchedData.value = this.convertValue(fetchedData);
        this.fetchedData.push(fetchedData);
      });

      this.addBroker(broker.url, broker.port, broker.auth, broker.topics);
    });

    this.updateDom(self.config.animationSpeed);
  },

  // Define required styles.
  getStyles: function () {
    return ["MMM-MQTT.css", "font-awesome.css"];
  },

  // Define required scripts.
  getScripts: function () {
    return [];
  },

  // Define header.
  getHeader: function () {
    return this.data.header || this.config.header;
  },

  // Override dom generator.
  getDom: function () {
    const wrapper = document.createElement("table");
    wrapper.className = "wrapper";
    wrapper.id = "wrapper";

    // If no subscriptions were defined in the config file
    if (this.fetchedData.length === 0) {
      wrapper.innerHTML = this.translate("EMPTY");
      wrapper.className = "light small dimmed";
      return wrapper;
    }

    // Sort fetched data based on their position value
    this.fetchedData.sort((a, b) => {
      return a.position - b.position;
    });

    this.fetchedData.forEach((subscription) => {
      const subscriptionWrapper = document.createElement("tr");
      subscriptionWrapper.className = "subscription";

      // Colors
      const colors = this.getColors(subscription);

      // Label
      const labelWrapper = document.createElement("td");
      labelWrapper.className = "label";
      labelWrapper.style.color = colors.label;

      if (subscription.showLabelAsIcon && subscription.icon !== "") {
        const iconWrapper = document.createElement("i");
        iconWrapper.classList.add("fa", "fa-fw", "fa-" + subscription.icon);
        labelWrapper.appendChild(iconWrapper);
      } else {
        labelWrapper.classList.add("align-left");
        labelWrapper.innerHTML = subscription.label;
      }
      subscriptionWrapper.appendChild(labelWrapper);

      // Value
      const valueWrapper = document.createElement("td");
      valueWrapper.className = "value align-right bright";
      valueWrapper.style.color = colors.value;
      if (subscription.value !== null && subscription.value !== undefined && `${subscription.value}`.trim() !== '') {
        valueWrapper.innerHTML = subscription.value;
      } else {
        valueWrapper.innerHTML = this.translate('LOADING');
      }
      subscriptionWrapper.appendChild(valueWrapper);

      // Suffix
      if (subscription.value !== null && subscription.value !== undefined && `${subscription.value}`.trim() !== '') {
        const suffixWrapper = document.createElement("span");
        suffixWrapper.className = "suffix align-left dimmed";
        suffixWrapper.style.color = colors.suffix;
        suffixWrapper.innerHTML = subscription.suffix;
        valueWrapper.appendChild(suffixWrapper);
      }

      wrapper.appendChild(subscriptionWrapper);
    });

    // Return the wrapper to the dom.
    return wrapper;
  },

  // Override socket notification handler.
  socketNotificationReceived: function (notification, payload) {
    if (notification == "DATA") {
      // Update data set with received data
      this.updateData(payload);
      // Update dom with given animation speed.
      this.updateDom(this.config.animationSpeed);
    } else if (notification == "ERROR") {
      // TODO: Update front-end to display specific error.
    }
  },

  /**
   * Requests the node helper to add the broker at the given url.
   *
   * @param {string} url The broker url
   * @param {bumber} port The port to access the broker
   * @param {object} auth The authentication credentials
   * @param {object} topics The topics of this broker
   */
  addBroker: function (url, port, auth, topics) {
    this.sendSocketNotification("ADD_BROKER", {
      id: this.identifier,
      url: url,
      port: port,
      auth: auth,
      topics: topics,
    });
  },

  updateData: function (receivedData) {
    for (let i = 0; i < this.fetchedData.length; i++) {
      let savedData = this.fetchedData[i];
      const wildcard = savedData.topic.indexOf("*") !== -1;
      const topicRegex = new RegExp('^' +
        (wildcard ?
          savedData.topic
            .replace(/[.+?^${}()|[\]\\]/ig, '\\$&')
            .replace(/\*/ig, '.*') :
          savedData.topic
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) +
        '$');
      if (
        receivedData.url !== savedData.url ||
        !topicRegex.test(receivedData.topic)
      ) {
        continue;
      }

      // We found our entry
      if (savedData.value === null) {
        // If we do not have received a message from this broker over the this topic, use the internal animation speed.
        this.config.animationSpeed = savedData.animationSpeed;
        this.fetchedData[i].animationSpeed = 0;
      } else {
        // We already received a message from this broker over this topic, update immediatly.
        // (or use the internal animation speed, which should also be 0).
        this.config.animationSpeed = 0; //this.fetchedData[i].animationSpeed
      }
      // Update the received value
      this.fetchedData[i].value = receivedData.payload;
      // and convert it according to the specified factor and offset value
      this.fetchedData[i].value = this.convertValue(this.fetchedData[i]);

      const pastValues = this.fetchedData[i].pastValues;

      // If we saved more than 5 past values
      if (pastValues.length >= 5) {
        // Remove the first element
        pastValues.shift();
      }
      // and add the new element to end of the array
      pastValues.push(receivedData.payload);

      // Then calculate the average of the pastValue array
      const sum = pastValues.reduce((a, b) => parseFloat(a) + parseFloat(b));
      const avg = sum / pastValues.length;

      this.fetchedData[i].average = avg;
      break;
    }
  },

  // matchTopics: function(topicA, topicB) {
  //     const regTemp = /^\+$|^\+(?=\/)|(?<=\/)\+(?=\/)|(?<=\/)\+(?=$)/g;
  //     const reg = new RegExp("^", + topicA.replace(regTemp, "[^/]+") + "$");
  //     const match = topicB.match(reg);
  //     return match ? match.length == 1 : false;
  // }

  /**
   *
   * @param {} subscription
   * @returns The color definition of label, value and suffix.
   */
  getColors: function (subscription) {
    if (!subscription.colors || subscription.colors.length == 0) {
      return {};
    }

    let colors;
    for (let i = 0; i < subscription.colors.length; i++) {
      // Iterate over each color definiton
      colors = subscription.colors[i];
      // If the next "upTo"-Value is greater than the current value, break the loop, use the previous next color definition
      if (subscription.value < colors.upTo) {
        break;
      }
    }

    // and return it.
    return colors;
  },

  /**
   * Function to apply user defined conversions
   *
   * @param {object} subscription The current subscription
   * @returns {object} The converted value as object (?)
   */
  convertValue: function (subscription) {
    let subscriptionValue = subscription.value ?? "UNDEFINED";
    Log.debug("Converting value from: " + subscriptionValue);

    // If conversion should be done
    if (subscription.conversion) {
      // Iterate over all conversions
      for (let i = 0; i < subscription.conversion.length; i++) {
        // If the current value is equal to a conversion value,
        if (
          `${subscriptionValue}`.trim() ==
          `${subscription.conversion[i].from}`.trim()
        ) {
          Log.debug("to: " + subscription.conversion[i].to);
          // set the current value to its subscription value.
          return subscription.conversion[i].to;
        }
      }
    }

    if (!isNaN(subscriptionValue)) {
      if (subscription.factor && typeof subscription.factor === "number") {
        Log.debug("with a factor of: " + subscription.factor);
        subscriptionValue *= subscription.factor;
      }

      if (subscription.offset && typeof subscription.factor === "number") {
        Log.debug("with an offset of: " + subscription.offset);
        subscriptionValue += subscription.offset;
      }
      Log.debug("over: " + subscriptionValue);

      // Round subscriptionValue to given number of decimals
      subscriptionValue = (Math.round(subscriptionValue * 100) / 100).toFixed(subscription.decimals);
      Log.debug("to its final value of (with " + subscription.decimals + " decimals): " + subscriptionValue);
    }

    return subscriptionValue == "UNDEFINED" ? null : subscriptionValue;
  },
});
