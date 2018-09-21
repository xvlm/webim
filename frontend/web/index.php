<?php
defined('YII_DEBUG') or define('YII_DEBUG', true);
defined('YII_ENV') or define('YII_ENV', 'dev');

require __DIR__ . '../../../../yii-advanced-app-2.0.15/vendor/autoload.php';
require __DIR__ . '../../../../yii-advanced-app-2.0.15/vendor/yiisoft/yii2/Yii.php';
require __DIR__ . '../../../common/config/bootstrap.php';
require __DIR__ . '/../config/bootstrap.php';

$config = yii\helpers\ArrayHelper::merge(
    require __DIR__ . '/../../common/config/main.php',
    require __DIR__ . '/../../common/config/main-local.php',
    require __DIR__ . '/../config/main.php',
    require __DIR__ . '/../config/main-local.php'
);


//echo json_encode([-1.0471975511966,1.0471975511966]);exit;
(new yii\web\Application($config))->run();
