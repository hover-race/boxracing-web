import { CAR_MODELS, getCarModel } from './carModels.js'

function selectCar(scene) {
  const overlay = document.getElementById('car-selection')
  const options = document.getElementById('car-selection-options')
  const startButton = document.getElementById('car-selection-start')
  const nameInput = document.getElementById('player-name-input')
  let selectedCar = getCarModel(params.car_id)

  nameInput.value = playerControl.name
  nameInput.addEventListener('input', () => {
    const name = nameInput.value.trim()
    if (!name) return
    applyPlayerName(name)
  })

  const nameCaret = document.getElementById('player-name-caret')
  const nameMeasure = document.createElement('canvas').getContext('2d')

  function updateNameCaret() {
    if (document.activeElement !== nameInput || nameInput.selectionStart !== nameInput.selectionEnd) {
      nameCaret.classList.remove('is-on')
      return
    }
    const cs = getComputedStyle(nameInput)
    nameMeasure.font = cs.font
    const ch = nameMeasure.measureText('M').width
    const before = nameMeasure.measureText(nameInput.value.slice(0, nameInput.selectionStart)).width
    const total = nameMeasure.measureText(nameInput.value).width
    const padLeft = parseFloat(cs.paddingLeft)
    const inner = nameInput.clientWidth - padLeft - parseFloat(cs.paddingRight)
    nameCaret.style.width = `${ch}px`
    nameCaret.style.left = `${padLeft + (inner - total) / 2 + before}px`
    nameCaret.classList.add('is-on')
  }

  nameInput.addEventListener('focus', updateNameCaret)
  nameInput.addEventListener('click', updateNameCaret)
  nameInput.addEventListener('keyup', updateNameCaret)
  nameInput.addEventListener('input', updateNameCaret)
  document.addEventListener('selectionchange', updateNameCaret)

  function finish(carId) {
    applyPlayerName(nameInput.value)
    params.car_id = carId
    localStorage.setItem('car_id', carId)
    params.offlinePlay = true
    params.numBots = 4
    params.botDrive = true
    overlay.remove()
    return carId
  }

  if (params.skipIntro) {
    return Promise.resolve(finish(selectedCar.car_id))
  }

  function updateSelection() {
    for (const button of options.querySelectorAll('[data-car-id]')) {
      button.classList.toggle('selected', button.dataset.carId === selectedCar.car_id)
    }
    scene.show(selectedCar)
  }

  for (const carModel of CAR_MODELS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'car-selection-card'
    button.dataset.carId = carModel.car_id
    button.textContent = carModel.displayName
    button.addEventListener('click', () => {
      selectedCar = carModel
      updateSelection()
    })
    options.appendChild(button)
  }
  updateSelection()

  return new Promise(resolve => {
    let started = false
    const start = () => {
      if (started) return
      started = true
      resolve(finish(selectedCar.car_id))
    }
    startButton.addEventListener('click', start)
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      start()
    })
    nameInput.focus()
    nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length)
    updateNameCaret()
  })
}

async function startMainScene(project) {
  project.parent.removeChild(project.canvas)
  document.body.appendChild(project.canvas)

  const carScene = project.scenes.get('carSelection')
  await carScene.stop()

  // Car preview loads GLBs through enable3d's shared cache (ArrayBuffers keyed by URL).
  // MainScene.load.gltf() swaps the path for cache.get(path), which breaks GLTFLoader.load().
  carScene.cache.clear()

  const mainScene = project.scenes.get('main')
  mainScene.setSize(window.innerWidth, window.innerHeight)
  mainScene.setPixelRatio(Math.max(1, window.devicePixelRatio / 2))
  await mainScene.start('main')
}

export { selectCar, startMainScene }
