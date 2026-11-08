-- A spiked slime: the spike on its head hurts, so it cannot be stomped. Jump over it.
return nova.entity(require("entities.enemy"), { sprite = "enemies/spikeslime", bw = 38, bh = 40, speed = 40, stompable = false })
