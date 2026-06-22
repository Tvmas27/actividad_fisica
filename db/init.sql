CREATE DATABASE IF NOT EXISTS actividad_fisica;
USE actividad_fisica;

-- Crear tabla 'respuestas' según el SQL provisto
CREATE TABLE IF NOT EXISTS respuestas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha_encuesta DATE NOT NULL,
    genero VARCHAR(20) NOT NULL,
    edad INT NOT NULL,
    horas_sentado_dia INT NOT NULL,
    minutos_actividad_semana INT NOT NULL,
    tipo_actividad VARCHAR(50) NOT NULL,
    usa_app VARCHAR(3) NOT NULL,
    percepcion_salud INT NOT NULL
);

INSERT INTO respuestas (fecha_encuesta, genero, edad, horas_sentado_dia, minutos_actividad_semana, tipo_actividad, usa_app, percepcion_salud) VALUES
    ('2026-06-04', 'Hombre', 19, 2, 90, 'Caminata', 'Sí', 2),
    ('2026-06-04', 'Mujer', 19, 4, 90, 'Deportes', 'No', 7),
    ('2026-06-04', 'Mujer', 19, 3, 50, 'Caminata', 'No', 4),
    ('2026-06-04', 'Mujer', 18, 4, 70, 'Caminata', 'No', 2),
    ('2026-06-04', 'Mujer', 20, 3, 70, 'Deportes', 'No', 9),
    ('2026-06-04', 'Mujer', 19, 4, 30, 'Deportes', 'No', 7),
    ('2026-06-04', 'Mujer', 29, 4, 90, 'Gimnasio', 'No', 4),
    ('2026-06-04', 'Mujer', 24, 4, 90, 'Deportes', 'No', 4),
    ('2026-06-04', 'Hombre', 25, 4, 90, 'Gimnasio', 'No', 4),
    ('2026-06-04', 'Mujer', 58, 2, 90, 'Caminata', 'No', 7),
    ('2026-06-05', 'Hombre', 31, 4, 0, 'Ninguna', 'Sí', 7),
    ('2026-06-05', 'Hombre', 49, 1, 30, 'Gimnasio', 'No', 4),
    ('2026-06-05', 'Hombre', 47, 4, 70, 'Deportes', 'Sí', 9),
    ('2026-06-05', 'Mujer', 21, 4, 90, 'Caminata', 'No', 7),
    ('2026-06-05', 'Mujer', 22, 3, 90, 'Deportes', 'No', 7),
    ('2026-06-05', 'Hombre', 21, 4, 0, 'Ninguna', 'No', 7),
    ('2026-06-05', 'Hombre', 19, 4, 70, 'Gimnasio', 'Sí', 9),
    ('2026-06-06', 'Mujer', 38, 4, 50, 'Caminata', 'No', 4),
    ('2026-06-06', 'Mujer', 61, 3, 30, 'Caminata', 'No', 7),
    ('2026-06-06', 'Mujer', 16, 3, 90, 'Gimnasio', 'No', 4),
    ('2026-06-06', 'Mujer', 42, 4, 30, 'Ninguna', 'No', 7),
    ('2026-06-06', 'Hombre', 15, 4, 90, 'Deportes', 'No', 9),
    ('2026-06-06', 'Mujer', 42, 4, 30, 'Ninguna', 'No', 4),
    ('2026-06-06', 'Hombre', 42, 1, 30, 'Caminata', 'No', 9),
    ('2026-06-06', 'Mujer', 42, 4, 30, 'Caminata', 'No', 7),
    ('2026-06-06', 'Hombre', 19, 2, 0, 'Caminata', 'Sí', 7),
    ('2026-06-06', 'Mujer', 40, 3, 30, 'Caminata', 'No', 7),
    ('2026-06-06', 'Hombre', 38, 1, 90, 'Gimnasio', 'No', 9),
    ('2026-06-06', 'Mujer', 35, 1, 30, 'Caminata', 'No', 9),
    ('2026-06-06', 'Mujer', 41, 3, 30, 'Caminata', 'No', 7),
    ('2026-06-06', 'Hombre', 19, 3, 30, 'Caminata', 'Sí', 7),
    ('2026-06-06', 'Mujer', 15, 4, 90, 'Deportes', 'No', 2),
    ('2026-06-06', 'Hombre', 42, 4, 50, 'Ninguna', 'No', 9),
    ('2026-06-06', 'Hombre', 40, 2, 90, 'Caminata', 'No', 7),
    ('2026-06-06', 'Mujer', 48, 4, 30, 'Caminata', 'No', 4),
    ('2026-06-06', 'Mujer', 31, 3, 30, 'Caminata', 'No', 2);
