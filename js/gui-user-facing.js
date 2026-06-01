userGui.add(params, 'tractionControl').name('Traction Control')

userGui.add(params, 'soundVolume', 0, 100).step(1).name('Engine Volume %')

userGui.add(vehicleParams, 'steeringSensitivity', 0.1, 2.0).step(0.1).name('Steering Sensitivity')

userGui.open()
