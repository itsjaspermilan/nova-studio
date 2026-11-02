#include "transform.h"
#include <float.h>
#include <math.h>

bool nova_rotation_valid(NovaVec3 degrees)
{
    return isfinite(degrees.x) && isfinite(degrees.y) && isfinite(degrees.z) &&
        fabsf(degrees.x) <= 360 && fabsf(degrees.y) <= 360 && fabsf(degrees.z) <= 360;
}

float nova_angle_normalize(double degrees)
{
    double value = fmod(degrees, 360);
    if (value >= 180) value -= 360;
    if (value < -180) value += 360;
    float result = (float)value;
    if (result >= 180) result = -180;
    return result == 0 ? 0 : result;
}

static NovaVec3 rotate(NovaVec3 point, NovaVec3 degrees, bool inverse)
{
    float v[] = {point.x, point.y, point.z}, angles[] = {degrees.x, degrees.y, degrees.z};
    const int first[] = {1, 2, 0}, second[] = {2, 0, 1};
    for (int step = 0; step < 3; ++step) {
        int a = inverse ? 2 - step : step;
        float angle = angles[a] * (inverse ? -1 : 1) * 0.017453292519943295f;
        float c = cosf(angle), s = sinf(angle), x = v[first[a]], y = v[second[a]];
        v[first[a]] = c * x - s * y;
        v[second[a]] = s * x + c * y;
    }
    return (NovaVec3){v[0], v[1], v[2]};
}

NovaVec3 nova_rotate(NovaVec3 point, NovaVec3 degrees) { return rotate(point, degrees, false); }
NovaVec3 nova_unrotate(NovaVec3 point, NovaVec3 degrees) { return rotate(point, degrees, true); }

NovaVec3 nova_transform_point(NovaVec3 point, NovaVec3 position, NovaVec3 size, NovaVec3 rotation)
{
    NovaVec3 v = nova_rotate((NovaVec3){point.x * size.x, point.y * size.y, point.z * size.z}, rotation);
    return (NovaVec3){v.x + position.x, v.y + position.y, v.z + position.z};
}

NovaVec3 nova_inverse_direction(NovaVec3 direction, NovaVec3 size, NovaVec3 rotation)
{
    NovaVec3 v = nova_unrotate(direction, rotation);
    return (NovaVec3){v.x / size.x, v.y / size.y, v.z / size.z};
}

NovaVec3 nova_inverse_point(NovaVec3 point, NovaVec3 position, NovaVec3 size, NovaVec3 rotation)
{
    return nova_inverse_direction((NovaVec3){point.x - position.x, point.y - position.y, point.z - position.z},
        size, rotation);
}

void nova_transform_bounds(NovaVec3 minimum, NovaVec3 maximum, NovaVec3 position,
    NovaVec3 size, NovaVec3 rotation, NovaVec3 *world_minimum, NovaVec3 *world_maximum)
{
    *world_minimum = (NovaVec3){FLT_MAX, FLT_MAX, FLT_MAX};
    *world_maximum = (NovaVec3){-FLT_MAX, -FLT_MAX, -FLT_MAX};
    for (int i = 0; i < 8; ++i) {
        NovaVec3 p = nova_transform_point((NovaVec3){i & 1 ? maximum.x : minimum.x,
            i & 2 ? maximum.y : minimum.y, i & 4 ? maximum.z : minimum.z}, position, size, rotation);
        world_minimum->x = fminf(world_minimum->x, p.x);
        world_minimum->y = fminf(world_minimum->y, p.y);
        world_minimum->z = fminf(world_minimum->z, p.z);
        world_maximum->x = fmaxf(world_maximum->x, p.x);
        world_maximum->y = fmaxf(world_maximum->y, p.y);
        world_maximum->z = fmaxf(world_maximum->z, p.z);
    }
}

bool nova_ray_box(NovaVec3 origin, NovaVec3 direction, NovaVec3 minimum,
    NovaVec3 maximum, NovaVec3 position, NovaVec3 size, NovaVec3 rotation, float *distance)
{
    if (!(size.x > 0 && size.y > 0 && size.z > 0)) return false;
    NovaVec3 o = nova_inverse_point(origin, position, size, rotation);
    NovaVec3 d = nova_inverse_direction(direction, size, rotation);
    const float p[] = {o.x, o.y, o.z}, v[] = {d.x, d.y, d.z};
    const float lo[] = {minimum.x, minimum.y, minimum.z}, hi[] = {maximum.x, maximum.y, maximum.z};
    float near = 0, far = FLT_MAX;
    if (!isfinite(o.x) || !isfinite(o.y) || !isfinite(o.z) ||
        !isfinite(d.x) || !isfinite(d.y) || !isfinite(d.z) || (d.x == 0 && d.y == 0 && d.z == 0)) return false;
    for (int a = 0; a < 3; ++a) {
        if (v[a] == 0) {
            if (p[a] < lo[a] || p[a] > hi[a]) return false;
        } else {
            float t0 = (lo[a] - p[a]) / v[a], t1 = (hi[a] - p[a]) / v[a];
            near = fmaxf(near, fminf(t0, t1));
            far = fminf(far, fmaxf(t0, t1));
            if (near > far) return false;
        }
    }
    if (distance) *distance = near;
    return true;
}
