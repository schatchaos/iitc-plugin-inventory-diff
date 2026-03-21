// ==UserScript==
// @id              inventoryDiff
// @name            IITC Plugin: Inventory Diff
// @category        Info
// @version         0.1.1
// @namespace       https://github.com/schatchaos/iitc-plugin-inventory-diff
// @homepageURL     https://github.com/schatchaos/iitc-plugin-inventory-diff
// @downloadURL     https://github.com/schatchaos/iitc-plugin-inventory-diff/raw/main/inventory-diff.user.js
// @description     Capture inventory snapshots and compare diffs between them
// @author          Søren Schrøder
// @include         https://intel.ingress.com/*
// @match           https://intel.ingress.com/*
// @grant           none
// ==/UserScript==

/* global $, window, IITC */

function wrapper(plugin_info) {
  if (typeof window.plugin !== 'function') window.plugin = function () {};

  window.plugin.inventoryDiff = function () {};
  var self = window.plugin.inventoryDiff;
  plugin_info.buildName = 'inventoryDiff';
  plugin_info.pluginId = 'inventoryDiff';

  var STORAGE_KEY = 'plugin-inventory-diff-snapshots';
  var MAX_SNAPSHOTS = 50;

  // ══════════════════════════════════════════════════════════
  // Phase 1: Parse inventory into a structured snapshot
  // ══════════════════════════════════════════════════════════

  /**
   * Parse a raw getInventory API response into a structured snapshot.
   *
   * Snapshot schema:
   * {
   *   timestamp: <epoch ms>,
   *   items: {
   *     "<TYPE> <LEVEL_OR_RARITY>": <count>,
   *     ...
   *   },
   *   keys: {
   *     "<portalGuid>": { count: <n>, title: <string>, location: "<hexLat,hexLng>" },
   *     ...
   *   }
   * }
   *
   * Item key examples:
   *   "XMP_BURSTER 8"           (resourceWithLevels)
   *   "PORTAL_SHIELD RARE"      (modResource)
   *   "EMITTER_A VERY_RARE"     (modResource — link amp)
   *   "FORCE_AMP RARE"          (modResource)
   *   "MEDIA COMMON"            (resource)
   *   "FLIP_CARD ADA"           (resource + flipCard)
   *   "APEX"                    (playerPowerupResource)
   *   "FRACKER"                 (timedPowerupResource.designation)
   */
  self.parseInventory = function (data) {
    var snapshot = {
      timestamp: Date.now(),
      items: {},
      keys: {}
    };

    if (!data || !data.result) return snapshot;

    var lockerKeyCount = 0;

    data.result.forEach(function (item) {
      // Count the top-level item as 1
      parseItem(item, 1, snapshot);

      // Items stored inside a container (capsule / quantum capsule)
      if (item[2] && item[2].container) {
        var isLocker = item[2].resource && item[2].resource.resourceType === 'KEY_CAPSULE';
        item[2].container.stackableItems.forEach(function (stackable) {
          var count = stackable.itemGuids.length;
          parseItem(stackable.exampleGameEntity, count, snapshot);
          // Track keys inside key lockers separately
          if (isLocker &&
              stackable.exampleGameEntity[2] &&
              stackable.exampleGameEntity[2].resource &&
              stackable.exampleGameEntity[2].resource.resourceType === 'PORTAL_LINK_KEY') {
            lockerKeyCount += count;
          }
        });
      }
    });

    // Synthetic: keys NOT in lockers (counts toward 2500 limit)
    var totalKeys = Object.keys(snapshot.keys).reduce(function (sum, g) { return sum + snapshot.keys[g].count; }, 0);
    snapshot.items['KEYS']        = totalKeys - lockerKeyCount;
    snapshot.items['KEYS_LOCKER'] = lockerKeyCount;

    return snapshot;
  };

  /**
   * Accumulate a single item (or stack) into the snapshot.
   * @param {Array}  item     Raw item array from the API: [ts, action, itemData]
   * @param {number} count    How many of this item to add
   * @param {Object} snapshot The snapshot being built
   */
  function parseItem(item, count, snapshot) {
    if (!item || !item[2]) return;
    var d = item[2];

    // ── Portal link key ──────────────────────────────────────
    if (d.resource && d.resource.resourceType === 'PORTAL_LINK_KEY' && d.portalCoupler) {
      var guid = d.portalCoupler.portalGuid;
      if (!snapshot.keys[guid]) {
        snapshot.keys[guid] = {
          count: 0,
          title: d.portalCoupler.portalTitle || guid,
          location: d.portalCoupler.portalLocation || ''
        };
      }
      snapshot.keys[guid].count += count;
      return;
    }

    // ── Flip cards (ADA Refactor, Jarvis Virus) ───────────────
    if (d.resource && d.flipCard) {
      var keyFC = d.resource.resourceType + ' ' + d.flipCard.flipCardType;
      snapshot.items[keyFC] = (snapshot.items[keyFC] || 0) + count;
      return;
    }

    // ── Player powerups (Apex, etc.) ──────────────────────────
    if (d.resource && d.resource.resourceType === 'PLAYER_POWERUP' && d.playerPowerupResource) {
      var keyPP = d.playerPowerupResource.playerPowerupEnum;
      snapshot.items[keyPP] = (snapshot.items[keyPP] || 0) + count;
      return;
    }

    // ── Portal powerups (beacons, frackers) ───────────────────
    if (d.resource && d.resource.resourceType === 'PORTAL_POWERUP' && d.timedPowerupResource) {
      var keyTPP = d.timedPowerupResource.designation;
      snapshot.items[keyTPP] = (snapshot.items[keyTPP] || 0) + count;
      return;
    }

    // ── Standard resources (media, capsules, etc.) ────────────
    if (d.resource) {
      var keyR = d.resource.resourceType + ' ' + d.resource.resourceRarity;
      snapshot.items[keyR] = (snapshot.items[keyR] || 0) + count;
      return;
    }

    // ── Leveled resources (resonators, XMP bursters, etc.) ────
    if (d.resourceWithLevels) {
      var keyL = d.resourceWithLevels.resourceType + ' ' + d.resourceWithLevels.level;
      snapshot.items[keyL] = (snapshot.items[keyL] || 0) + count;
      return;
    }

    // ── Mods (shields, turrets, heat sinks, etc.) ─────────────
    if (d.modResource) {
      var keyM = d.modResource.resourceType + ' ' + d.modResource.rarity;
      snapshot.items[keyM] = (snapshot.items[keyM] || 0) + count;
      return;
    }
  }

  // ══════════════════════════════════════════════════════════
  // Phase 2: Snapshot persistence in localStorage
  // ══════════════════════════════════════════════════════════

  self.loadSnapshots = function () {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('[inventory-diff] Failed to load snapshots:', e);
      return [];
    }
  };

  self.saveSnapshot = function (snapshot) {
    var snapshots = self.loadSnapshots();
    snapshots.push(snapshot);
    // Keep only the most recent MAX_SNAPSHOTS
    if (snapshots.length > MAX_SNAPSHOTS) {
      snapshots = snapshots.slice(snapshots.length - MAX_SNAPSHOTS);
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
    } catch (e) {
      console.error('[inventory-diff] Failed to save:', e);
      alert('[inventory-diff] localStorage full — could not save snapshot.');
    }
    return snapshot;
  };

  self.deleteSnapshot = function (timestamp) {
    var snapshots = self.loadSnapshots().filter(function (s) {
      return s.timestamp !== timestamp;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  };

  // ══════════════════════════════════════════════════════════
  // Phase 3: Diff computation and UI
  // ══════════════════════════════════════════════════════════

  /**
   * Compute the diff from snapshot A to snapshot B.
   *
   * Returns:
   * {
   *   items: { "<key>": <delta> },          // positive = gained, negative = lost
   *   keys:  { "<guid>": { delta, title } }
   * }
   * Only entries with delta !== 0 are included.
   */
  self.computeDiff = function (snapshotA, snapshotB) {
    var diff = { items: {}, keys: {} };

    // Items
    var allItemKeys = {};
    Object.keys(snapshotA.items).forEach(function (k) { allItemKeys[k] = true; });
    Object.keys(snapshotB.items).forEach(function (k) { allItemKeys[k] = true; });
    Object.keys(allItemKeys).forEach(function (k) {
      var delta = (snapshotB.items[k] || 0) - (snapshotA.items[k] || 0);
      if (delta !== 0) diff.items[k] = delta;
    });

    // Portal keys
    var allGuids = {};
    Object.keys(snapshotA.keys).forEach(function (g) { allGuids[g] = true; });
    Object.keys(snapshotB.keys).forEach(function (g) { allGuids[g] = true; });
    Object.keys(allGuids).forEach(function (g) {
      var a = snapshotA.keys[g] ? snapshotA.keys[g].count : 0;
      var b = snapshotB.keys[g] ? snapshotB.keys[g].count : 0;
      var delta = b - a;
      if (delta !== 0) {
        var meta = snapshotB.keys[g] || snapshotA.keys[g];
        diff.keys[g] = { delta: delta, title: meta.title };
      }
    });

    return diff;
  };

  // ── UI helpers ─────────────────────────────────────────────

  function fmtDate(ts) {
    return new Date(ts).toLocaleString();
  }

  // Human-readable names for raw Ingress type strings.
  // The suffix (level / rarity) is appended separately by fmtLabel.
  var DISPLAY_NAMES = {
    // Weapons
    EMP_BURSTER:        'XMP',
    ULTRA_STRIKE:       'Ultrastrike',
    // Mods
    RES_SHIELD:         'Portal Shield',
    EXTRA_SHIELD:       'Aegis Shield',
    TURRET:             'Turret',
    FORCE_AMP:          'Force Amp',
    HEATSINK:           'Heat Sink',
    MULTIHACK:          'Multi-hack',
    EMITTER_A:          'Resonator',
    LINK_AMPLIFIER:     'Link Amp',
    ULTRA_LINK_AMP:     'Softbank Ultra Link',
    TRANSMUTER_ATTACK:  'ITO (-)',
    TRANSMUTER_DEFENSE: 'ITO (+)',
    // Power cubes
    POWER_CUBE:         'Power Cube',
    BOOSTED_POWER_CUBE: 'Hypercube',
    // Power-ups
    FRACK:              'Portal Fracker',
    APEX:               'APEX',
    FW_RES:             'Firework',   // explicit entries kept for clarity
    FW_ENL:             'Firework',
    // Flip cards
    ADA:                'ADA Refactor',
    JARVIS:             'Jarvis Virus',
    // Beacons
    ENL:                'Beacon',
    RES:                'Beacon',
    MEET:               'Beacon',
    NIA:                'Beacon',
    TOASTY:             'Beacon',
    TARGET:             'Beacon',
    BN_BLM:             'Beacon',
    // Containers
    CAPSULE:            'Capsule',
    KEY_CAPSULE:        'Key Capsule',
    KINETIC_CAPSULE:    'Kinetic Capsule',
    INTEREST_CAPSULE:   'Quantum Capsule',
    // Other
    MEDIA:              'Media',
    DRONE:              'Drone',
    DRONE_7_SERIES:     'Drone (Series 7)',
  };

  // Rarity / suffix formatting
  var DISPLAY_SUFFIX = {
    VERY_RARE:  'Very Rare',
    RARE:       'Rare',
    COMMON:     'Common',
    VERY_COMMON: 'Very Common',
  };

  var CATEGORY_ORDER = ['boosts', 'capsules', 'resonators', 'weapons', 'cubes', 'mods', 'other'];

  var CATEGORIES = {
    // Weapons
    EMP_BURSTER:        'weapons',
    ULTRA_STRIKE:       'weapons',
    // Resonators
    EMITTER_A:          'resonators',
    // Mods
    RES_SHIELD:         'mods',
    EXTRA_SHIELD:       'mods',
    TURRET:             'mods',
    FORCE_AMP:          'mods',
    HEATSINK:           'mods',
    MULTIHACK:          'mods',
    LINK_AMPLIFIER:     'mods',
    ULTRA_LINK_AMP:     'mods',
    TRANSMUTER_ATTACK:  'mods',
    TRANSMUTER_DEFENSE: 'mods',
    // Cubes
    POWER_CUBE:         'cubes',
    BOOSTED_POWER_CUBE: 'cubes',
    // Capsules
    CAPSULE:            'capsules',
    KEY_CAPSULE:        'capsules',
    KINETIC_CAPSULE:    'capsules',
    INTEREST_CAPSULE:   'capsules',
    // Boosts
    FRACK:              'boosts',
    APEX:               'boosts',
    FLIP_CARD:          'weapons',
    TOASTY:             'boosts',
    MEET:               'boosts',
    ENL:                'boosts',
    RES:                'boosts',
    NIA:                'boosts',
    TARGET:             'boosts',
    // Other
    DRONE:              'other',
    MEDIA:              'other',
    DRONE_7_SERIES:     'other',
  };

  // Prefix-based category fallbacks (FW_, BN_, BB_ → boosts)
  var PREFIX_CATEGORIES = [
    { prefix: 'FW_', cat: 'boosts' },
    { prefix: 'BN_', cat: 'boosts' },
    { prefix: 'BB_', cat: 'boosts' },
  ];

  var RARITY_ORDER = { COMMON: 0, RARE: 1, VERY_RARE: 2, VERY_COMMON: -1 };

  function getCategory(rawType) {
    if (CATEGORIES[rawType]) return CATEGORIES[rawType];
    for (var i = 0; i < PREFIX_CATEGORIES.length; i++) {
      if (rawType.indexOf(PREFIX_CATEGORIES[i].prefix) === 0) return PREFIX_CATEGORIES[i].cat;
    }
    return 'other';
  }

  // Prefix-based fallbacks — matched when no exact DISPLAY_NAMES entry exists.
  var PREFIX_NAMES = [
    { prefix: 'FW_',  name: 'Firework' },
    { prefix: 'BN_',  name: 'Beacon'   },
    { prefix: 'BB_',  name: 'Battle Beacon' },
  ];

  /**
   * Turn an item key into a readable label.
   * "XMP_BURSTER 8"      → "XMP Burster L8"
   * "PORTAL_SHIELD RARE" → "Portal Shield (Rare)"
   * Falls back to naive title-casing for unknown types.
   */
  function fmtLabel(key) {
    var parts = key.split(' ');
    var type = parts[0];
    var suffix = parts.slice(1).join(' ');

    var typeName = DISPLAY_NAMES[type] ||
      PREFIX_NAMES.find(function (p) { return type.indexOf(p.prefix) === 0; }) && PREFIX_NAMES.find(function (p) { return type.indexOf(p.prefix) === 0; }).name ||
      type.replace(/_/g, ' ').split(' ').map(function (w) {
        return w.charAt(0) + w.slice(1).toLowerCase();
      }).join(' ');

    if (!suffix) return typeName;

    // Numeric suffix = level
    if (/^\d+$/.test(suffix)) return typeName + ' L' + suffix;

    // Rarity suffix
    var rarityName = DISPLAY_SUFFIX[suffix] ||
      suffix.charAt(0) + suffix.slice(1).toLowerCase();
    return typeName + ' (' + rarityName + ')';
  }

  // ── Inventory detail dialog ────────────────────────────────

  self.showInventoryDialog = function (snapshot) {
    // Group items into categories (skip synthetic KEYS and ENTITLEMENT)
    var groups = {};
    CATEGORY_ORDER.forEach(function (cat) { groups[cat] = []; });

    Object.keys(snapshot.items).forEach(function (key) {
      if (key === 'KEYS') return;
      var parts = key.split(' ');
      var rawType = parts[0];
      if (rawType === 'ENTITLEMENT') return;
      var cat = getCategory(rawType);
      groups[cat].push({ key: key, count: snapshot.items[key] });
    });

    // Sort items within each category
    CATEGORY_ORDER.forEach(function (cat) {
      groups[cat].sort(function (a, b) {
        var la = fmtLabel(a.key), lb = fmtLabel(b.key);
        if (la !== lb) return la.localeCompare(lb);
        return 0;
      });
    });

    var h = '<div style="font-size:12px;">';

    CATEGORY_ORDER.forEach(function (cat) {
      var items = groups[cat];
      if (!items.length) return;
      var total = items.reduce(function (s, r) { return s + r.count; }, 0);
      var catId = 'inv-detail-cat-' + snapshot.timestamp + '-' + cat;

      h += '<div style="margin-bottom:4px;">';
      h += '<div class="inv-detail-hdr" data-target="' + catId + '" style="cursor:pointer;padding:3px 4px;background:#333;font-weight:bold;">';
      h += '▶ ' + cat.charAt(0).toUpperCase() + cat.slice(1) + ' <span style="color:#888;font-weight:normal;">(' + total + ')</span>';
      h += '</div>';
      h += '<div id="' + catId + '" style="display:none;">';
      h += '<table style="width:100%;border-collapse:collapse;">';
      items.forEach(function (row) {
        h += '<tr style="border-bottom:1px solid #222;">';
        h += '<td style="padding:2px 8px;">' + fmtLabel(row.key) + '</td>';
        h += '<td style="text-align:right;padding:2px 8px;">' + row.count + '</td>';
        h += '</tr>';
      });
      h += '</table></div></div>';
    });

    h += '</div>';

    var dlg = window.dialog({
      title: 'Inventory — ' + fmtDate(snapshot.timestamp),
      html: h,
      width: 380,
      maxHeight: window.innerHeight * 0.85,
      id: 'inventory-detail-dialog-' + snapshot.timestamp
    });

    dlg.on('click', '.inv-detail-hdr', function () {
      var target = $('#' + $(this).data('target'));
      var open = target.is(':visible');
      target.toggle(!open);
      $(this).html($(this).html().replace(open ? '▼' : '▶', open ? '▶' : '▼'));
    });
  };

  // ── Diff dialog ────────────────────────────────────────────

  self.showDialog = function () {
    var snapshots = self.loadSnapshots();

    var dlg = window.dialog({
      title: 'Inventory Diff',
      html: buildDialogHtml(snapshots),
      width: 560,
      maxHeight: window.innerHeight * 0.85,
      id: 'inventory-diff-dialog'
    });

    // Take snapshot
    dlg.find('#inv-diff-btn-snap').on('click', function () {
      var btn = $(this);

      var newest = snapshots.length ? snapshots[snapshots.length - 1].timestamp : 0;
      var age = Date.now() - newest;
      if (newest && age < 5 * 60 * 1000) {
        var ageMin = Math.floor(age / 60000);
        var ageSec = Math.floor((age % 60000) / 1000);
        var ageStr = ageMin > 0 ? ageMin + 'm ' + ageSec + 's' : ageSec + 's';
        if (!confirm('Last snapshot is only ' + ageStr + ' old.\nFetching too often may hit the rate limit.\n\nFetch anyway?')) {
          return;
        }
      }

      btn.prop('disabled', true).text('Fetching…');
      window.postAjax(
        'getInventory',
        { lastQueryTimestamp: 0 },
        function (data) {
          console.log('[inventory-diff] raw API response:', data);
          var snapshot = self.parseInventory(data);
          console.log('[inventory-diff] parsed snapshot saved to localStorage:', snapshot);
          self.saveSnapshot(snapshot);
          dlg.dialog('close');
          setTimeout(self.showDialog, 50);
        },
        function () {
          btn.prop('disabled', false).text('Take Snapshot');
          dlg.find('#inv-diff-status').text('Error: request failed.');
        }
      );
    });

    // Open inventory detail
    dlg.on('click', '.inv-diff-detail', function (e) {
      e.preventDefault();
      var idx = parseInt($(this).data('idx'), 10);
      self.showInventoryDialog(snapshots[idx]);
    });

    // Delete a snapshot
    dlg.on('click', '.inv-diff-del', function () {
      var ts = parseInt($(this).data('ts'), 10);
      self.deleteSnapshot(ts);
      dlg.dialog('close');
      setTimeout(self.showDialog, 50);
    });

    // Compute and display diff
    dlg.find('#inv-diff-btn-diff').on('click', function () {
      var idxA = parseInt(dlg.find('input[name="inv-diff-a"]:checked').val(), 10);
      var idxB = parseInt(dlg.find('input[name="inv-diff-b"]:checked').val(), 10);

      if (isNaN(idxA) || isNaN(idxB)) {
        dlg.find('#inv-diff-output').html('<p>Select both A and B snapshots.</p>');
        return;
      }
      if (idxA === idxB) {
        dlg.find('#inv-diff-output').html('<p>A and B must be different snapshots.</p>');
        return;
      }

      // Always diff earlier → later regardless of which radio was picked
      if (snapshots[idxA].timestamp > snapshots[idxB].timestamp) {
        var tmp = idxA; idxA = idxB; idxB = tmp;
      }
      var diff = self.computeDiff(snapshots[idxA], snapshots[idxB]);
      var showKeyDetail = dlg.find('#inv-diff-key-detail').prop('checked');
      dlg.find('#inv-diff-output').html(renderDiff(diff, showKeyDetail));
    });
  };

  function buildDialogHtml(snapshots) {
    var s = '<div style="font-size:12px;">';

    // Controls row
    s += '<div style="margin-bottom:8px;">';
    s += '<button id="inv-diff-btn-snap">Take Snapshot</button>';
    s += ' <span id="inv-diff-status" style="color:#888;font-size:11px;"></span>';
    s += '</div>';

    if (snapshots.length === 0) {
      s += '<p style="color:#aaa;">No snapshots yet. Take one to get started.</p>';
      s += '</div>';
      return s;
    }

    // Snapshot list — newest first
    s += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
    s += '<thead><tr style="border-bottom:1px solid #555;text-align:left;">';
    s += '<th style="width:2em;">A</th><th style="width:2em;">B</th>';
    s += '<th>Date</th>';
    s += '<th style="text-align:right;">Items</th>';
    s += '<th style="text-align:right;">Keys</th>';
    s += '<th style="text-align:right;">Total</th>';
    s += '<th style="text-align:right;color:#888;">(Lockers)</th>';
    s += '<th></th>';
    s += '</tr></thead><tbody>';

    for (var i = snapshots.length - 1; i >= 0; i--) {
      var snap = snapshots[i];
      var totalItems = Object.keys(snap.items).reduce(function (sum, k) {
        var t = k.split(' ')[0];
        return (t === 'KEYS' || t === 'KEYS_LOCKER' || t === 'ENTITLEMENT') ? sum : sum + snap.items[k];
      }, 0);
      var freeKeys   = snap.items['KEYS']        || 0;
      var lockerKeys = snap.items['KEYS_LOCKER'] || 0;
      var grandTotal = totalItems + freeKeys;

      // Default A = oldest shown, B = newest shown
      var checkedA = (i === 0 && snapshots.length > 1) ? ' checked' : '';
      var checkedB = (i === snapshots.length - 1) ? ' checked' : '';

      s += '<tr style="border-bottom:1px solid #333;">';
      s += '<td style="text-align:center;"><input type="radio" name="inv-diff-a" value="' + i + '"' + checkedA + '></td>';
      s += '<td style="text-align:center;"><input type="radio" name="inv-diff-b" value="' + i + '"' + checkedB + '></td>';
      s += '<td style="padding:3px 4px;"><a href="#" class="inv-diff-detail" data-idx="' + i + '">' + fmtDate(snap.timestamp) + '</a></td>';
      s += '<td style="text-align:right;padding:3px 4px;">' + totalItems + '</td>';
      s += '<td style="text-align:right;padding:3px 4px;">' + freeKeys + '</td>';
      s += '<td style="text-align:right;padding:3px 4px;">' + grandTotal + '</td>';
      s += '<td style="text-align:right;padding:3px 4px;color:#888;">(' + lockerKeys + ')</td>';
      s += '<td style="text-align:right;padding:3px 2px;">';
      s += '<button class="inv-diff-del" data-ts="' + snap.timestamp + '" style="font-size:10px;padding:1px 4px;">✕</button>';
      s += '</td>';
      s += '</tr>';
    }

    s += '</tbody></table>';

    if (snapshots.length >= 2) {
      s += '<div style="margin-top:8px;">';
      s += '<button id="inv-diff-btn-diff">Show Diff (A → B)</button>';
      s += ' <label style="font-size:11px;color:#aaa;margin-left:8px;">';
      s += '<input type="checkbox" id="inv-diff-key-detail"> per-portal key detail';
      s += '</label>';
      s += '</div>';
    }

    s += '<div id="inv-diff-output" style="margin-top:8px;"></div>';
    s += '</div>';
    return s;
  }

  /**
   * @param {Object}  diff
   * @param {boolean} showKeyDetail  true = show per-portal key diffs, false = rely on KEYS synthetic only
   */
  function renderDiff(diff, showKeyDetail) {
    var gained = [];
    var lost = [];

    Object.keys(diff.items).sort().forEach(function (k) {
      if (k.split(' ')[0] === 'ENTITLEMENT') return;
      var delta = diff.items[k];
      (delta > 0 ? gained : lost).push({ label: fmtLabel(k), delta: delta });
    });

    if (showKeyDetail) {
      Object.keys(diff.keys).sort(function (a, b) {
        return diff.keys[a].title.localeCompare(diff.keys[b].title);
      }).forEach(function (g) {
        var k = diff.keys[g];
        (k.delta > 0 ? gained : lost).push({ label: 'Key: ' + k.title, delta: k.delta });
      });
    }

    if (gained.length === 0 && lost.length === 0) {
      return '<p style="color:#888;">No differences between the two snapshots.</p>';
    }

    var h = '<table style="width:100%;border-collapse:collapse;font-size:11px;">';

    function section(list, color, label) {
      if (!list.length) return;
      h += '<tr><td colspan="2" style="padding:6px 4px 2px;font-weight:bold;color:#aaa;border-top:1px solid #444;">' + label + '</td></tr>';
      list.forEach(function (row) {
        h += '<tr>';
        h += '<td style="padding:1px 4px;color:' + color + ';">' + row.label + '</td>';
        h += '<td style="text-align:right;padding:1px 4px;color:' + color + ';">' + (row.delta > 0 ? '+' : '') + row.delta + '</td>';
        h += '</tr>';
      });
    }

    section(gained, '#4caf50', 'Gained');
    section(lost,   '#f44336', 'Lost / Used');

    h += '</table>';
    return h;
  }

  // ══════════════════════════════════════════════════════════
  // Bootstrap
  // ══════════════════════════════════════════════════════════

  function setup() {
    IITC.toolbox.addButton({
      label: 'Inventory Diff',
      action: self.showDialog
    });
    console.log('[inventory-diff] loaded');
  }

  setup.info = plugin_info;

  if (window.iitcLoaded) {
    setup();
  } else {
    if (!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
  }
}

// ── Userscript loader (Tampermonkey / Greasemonkey compatible) ──────────────
(function () {
  var plugin_info = {};
  if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) {
    plugin_info.script = {
      version: GM_info.script.version,
      name: GM_info.script.name,
      description: GM_info.script.description
    };
  }

  // Greasemonkey: inject via script tag to run in page context
  if (typeof unsafeWindow !== 'undefined' || typeof GM_info === 'undefined' || GM_info.scriptHandler !== 'Tampermonkey') {
    var script = document.createElement('script');
    script.appendChild(document.createTextNode('(' + wrapper + ')(' + JSON.stringify(plugin_info) + ');'));
    (document.body || document.head || document.documentElement).appendChild(script);
  } else {
    // Tampermonkey: run directly
    wrapper(plugin_info);
  }
})();
