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
  const nameBefore = document.getElementById('player-name-before')
  const nameAfter = document.getElementById('player-name-after')

  function updateNameVisual() {
    const value = nameInput.value
    const start = nameInput.selectionStart ?? value.length
    const end = nameInput.selectionEnd ?? value.length
    nameBefore.textContent = value.slice(0, start)
    nameAfter.textContent = value.slice(end)
    nameCaret.classList.toggle('is-on', document.activeElement === nameInput && start === end)
  }

  nameInput.addEventListener('focus', updateNameVisual)
  nameInput.addEventListener('blur', updateNameVisual)
  nameInput.addEventListener('click', updateNameVisual)
  nameInput.addEventListener('keyup', updateNameVisual)
  nameInput.addEventListener('input', updateNameVisual)
  document.addEventListener('selectionchange', updateNameVisual)
  updateNameVisual()

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
    updateNameVisual()
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
