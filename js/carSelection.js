import { CAR_MODELS, getCarModel } from './carModels.js'

function selectCar() {
  const overlay = document.getElementById('car-selection')
  const options = document.getElementById('car-selection-options')
  const startButton = document.getElementById('car-selection-start')
  let selectedCar = getCarModel(params.car_id)

  function updateSelection() {
    for (const button of options.querySelectorAll('[data-car-id]')) {
      button.classList.toggle('selected', button.dataset.carId === selectedCar.car_id)
    }
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
    startButton.addEventListener('click', () => {
      params.car_id = selectedCar.car_id
      localStorage.setItem('car_id', selectedCar.car_id)
      overlay.remove()
      resolve(selectedCar.car_id)
    }, { once: true })
  })
}

export { selectCar }
