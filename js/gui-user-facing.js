userGui.add(params, 'tractionControl').name('Traction Control')

userGui.add(vehicleParams, 'volume', 0, 100).step(1).name('Engine Volume %')
  .onChange((value) => {
    localStorage.setItem('engineVolume', value)
  })

userGui.add(vehicleParams, 'steeringSensitivity', 0.1, 2.0).step(0.1).name('Steering Sensitivity')

userGui.open()
